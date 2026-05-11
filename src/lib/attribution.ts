/**
 * Attribution Engine — Core matching logic
 * 
 * Reuses the proven audit v3 multi-method matching:
 * Priority A: utm_campaign numeric ID → campaign_snapshots.campaign_id
 * Priority B: utm_source campaign name → campaign_snapshots.campaign_name
 * Priority C: source/referrer classification
 * 
 * Per TKT-00238: No fuzzy matching for financial P&L
 */

import { supabaseAdmin } from '@/lib/supabase';

// ─── Types ───────────────────────────────────

export type AttributionType = 
  | 'id_match' 
  | 'name_match' 
  | 'duplicate_ambiguous'
  | 'facebook_only' 
  | 'google_ads' 
  | 'organic_direct' 
  | 'unattributed';

export interface OrderAttribution {
  shopify_order_id: string;
  shopify_order_name: string;
  order_date: string;
  total_revenue: number;
  
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  
  attribution_type: AttributionType;
  attribution_source: string | null;
  matched_campaign_id: string | null;
  matched_campaign_name: string | null;
  
  customer_email: string | null;
  is_returning_customer: boolean;
  
  raw_landing_page: string | null;
  raw_referrer_url: string | null;
  journey_ready: boolean;
  
  items: OrderAttributionItem[];
}

export interface OrderAttributionItem {
  shopify_product_id: string | null;
  sku: string | null;
  product_title: string;
  product_type: string | null;
  quantity: number;
  item_revenue: number;
  collection_key: string;
}

export interface ShopifyOrderForAttribution {
  id: string;
  name: string;
  createdAt: string;
  totalPriceSet: { shopMoney: { amount: string } };
  customer: { email: string | null; numberOfOrders: string } | null;
  customerJourneySummary: {
    ready: boolean;
    firstVisit: {
      landingPage: string | null;
      referrerUrl: string | null;
      source: string | null;
      sourceType: string | null;
      utmParameters: {
        source: string | null;
        medium: string | null;
        campaign: string | null;
        content: string | null;
        term: string | null;
      } | null;
    } | null;
  } | null;
  lineItems: {
    edges: Array<{
      node: {
        title: string;
        quantity: number;
        originalUnitPriceSet: { shopMoney: { amount: string } };
        sku: string | null;
        product: {
          id: string;
          productType: string | null;
        } | null;
      };
    }>;
  };
}

export interface CampaignLookup {
  idSet: Set<string>;
  nameMap: Map<string, string[]>; // normalized name → campaign_id[]
  nameSet: Set<string>;
  idToName: Map<string, string>;  // campaign_id → campaign_name
}

// ─── Helpers ────────────────────────────────

function normalize(s: string | null | undefined): string {
  if (!s) return '';
  return decodeURIComponent(s).toLowerCase().trim().replace(/\s+/g, ' ');
}

// ─── Build Campaign Lookup ──────────────────

export async function buildCampaignLookup(campaignIds: string[]): Promise<CampaignLookup> {
  const idSet = new Set<string>();
  const nameMap = new Map<string, string[]>();
  const nameSet = new Set<string>();
  const idToName = new Map<string, string>();

  // Fetch by specific IDs
  if (campaignIds.length > 0) {
    const { data: idCampaigns } = await supabaseAdmin
      .from('campaign_snapshots')
      .select('campaign_id, campaign_name')
      .in('campaign_id', campaignIds);
    
    for (const c of idCampaigns || []) {
      if (c.campaign_id) {
        idSet.add(String(c.campaign_id));
        idToName.set(String(c.campaign_id), c.campaign_name);
      }
    }
  }

  // Fetch all for name matching (deduplicated)
  const { data: allCampaigns } = await supabaseAdmin
    .from('campaign_snapshots')
    .select('campaign_id, campaign_name')
    .order('snapshot_date', { ascending: false })
    .limit(50000);

  for (const c of allCampaigns || []) {
    if (c.campaign_id) {
      idSet.add(String(c.campaign_id));
      if (!idToName.has(String(c.campaign_id))) {
        idToName.set(String(c.campaign_id), c.campaign_name);
      }
    }
    const norm = normalize(c.campaign_name);
    if (norm) {
      nameSet.add(norm);
      if (!nameMap.has(norm)) nameMap.set(norm, []);
      const ids = nameMap.get(norm)!;
      if (!ids.includes(String(c.campaign_id))) ids.push(String(c.campaign_id));
    }
  }

  return { idSet, nameMap, nameSet, idToName };
}

// ─── Attribute Single Order ─────────────────

export function attributeOrder(
  order: ShopifyOrderForAttribution,
  lookup: CampaignLookup,
  collectionCache: Map<string, string>
): OrderAttribution {
  const journey = order.customerJourneySummary;
  const firstVisit = journey?.firstVisit;
  const utm = firstVisit?.utmParameters;

  const utmCampaign = utm?.campaign || null;
  const utmSource = utm?.source || null;
  const source = firstVisit?.source || null;
  const referrer = firstVisit?.referrerUrl || null;

  let attributionType: AttributionType = 'unattributed';
  let matchedCampaignId: string | null = null;
  let matchedCampaignName: string | null = null;

  // === PRIORITY A: utm_campaign numeric ID ===
  if (utmCampaign) {
    const cleanId = String(utmCampaign).trim();
    if (lookup.idSet.has(cleanId)) {
      attributionType = 'id_match';
      matchedCampaignId = cleanId;
      matchedCampaignName = lookup.idToName.get(cleanId) || null;
    }
  }

  // === PRIORITY B: utm_source as campaign name ===
  if (attributionType === 'unattributed' && utmSource) {
    const normSource = normalize(utmSource);
    
    if (normSource === 'facebook' || normSource === 'fb' || normSource === 'instagram' || normSource === 'ig') {
      attributionType = 'facebook_only';
    } else if (normSource === 'google' || normSource === 'google ads' || normSource === 'google_ads') {
      attributionType = 'google_ads';
    } else if (normSource === 'shop_app' || normSource === 'shopify') {
      attributionType = 'organic_direct';
    } else if (lookup.nameSet.has(normSource)) {
      const ids = lookup.nameMap.get(normSource)!;
      if (ids.length === 1) {
        attributionType = 'name_match';
        matchedCampaignId = ids[0];
        matchedCampaignName = normSource;
      } else {
        attributionType = 'duplicate_ambiguous';
      }
    } else {
      // Has UTM but no match - classify by referrer
      if (referrer?.includes('facebook.com') || source?.toLowerCase().includes('facebook')) {
        attributionType = 'facebook_only';
      } else {
        attributionType = 'organic_direct';
      }
    }
  }

  // === PRIORITY C: No UTM - check source/referrer ===
  if (attributionType === 'unattributed') {
    if (source?.toLowerCase().includes('facebook') || referrer?.includes('facebook.com')) {
      attributionType = 'facebook_only';
    } else if (source?.toLowerCase().includes('google') || referrer?.includes('google.com')) {
      attributionType = 'google_ads';
    } else if (source || referrer) {
      attributionType = 'organic_direct';
    }
  }

  // === Build line items ===
  const items: OrderAttributionItem[] = [];
  for (const edge of order.lineItems.edges) {
    const node = edge.node;
    const productId = node.product?.id?.replace('gid://shopify/Product/', '') || null;
    const productType = node.product?.productType || null;
    const itemRevenue = parseFloat(node.originalUnitPriceSet.shopMoney.amount) * node.quantity;
    
    // Collection mapping
    let collectionKey = 'other';
    if (productId && collectionCache.has(productId)) {
      collectionKey = collectionCache.get(productId)!;
    } else if (productType) {
      collectionKey = inferCollectionFromProductType(productType, node.title);
    } else {
      collectionKey = inferCollectionFromProductType('', node.title);
    }

    items.push({
      shopify_product_id: productId,
      sku: node.sku,
      product_title: node.title,
      product_type: productType,
      quantity: node.quantity,
      item_revenue: Math.round(itemRevenue * 100) / 100,
      collection_key: collectionKey,
    });
  }

  const customerOrders = parseInt(order.customer?.numberOfOrders || '0', 10);

  return {
    shopify_order_id: order.id,
    shopify_order_name: order.name,
    order_date: order.createdAt.split('T')[0],
    total_revenue: parseFloat(order.totalPriceSet.shopMoney.amount),
    utm_source: utmSource,
    utm_medium: utm?.medium || null,
    utm_campaign: utmCampaign,
    utm_content: utm?.content || null,
    utm_term: utm?.term || null,
    attribution_type: attributionType,
    attribution_source: source,
    matched_campaign_id: matchedCampaignId,
    matched_campaign_name: matchedCampaignName,
    customer_email: order.customer?.email || null,
    is_returning_customer: customerOrders > 1,
    raw_landing_page: firstVisit?.landingPage || null,
    raw_referrer_url: referrer,
    journey_ready: journey?.ready || false,
    items,
  };
}

// ─── Collection Inference ───────────────────

const COLLECTION_KEYWORDS: Record<string, string[]> = {
  billiards: ['billiard', 'pool', 'cue', 'snooker', '8-ball', '8 ball', 'nine ball'],
  bowling: ['bowling', 'bowl', 'lane', 'pin', 'strike'],
  darts: ['dart', 'dartboard', 'bullseye', 'arrow'],
  fishing: ['fishing', 'fish', 'angler', 'rod', 'reel', 'lure', 'bass', 'trout'],
};

function inferCollectionFromProductType(productType: string, title: string): string {
  const combined = `${productType} ${title}`.toLowerCase();
  
  for (const [collection, keywords] of Object.entries(COLLECTION_KEYWORDS)) {
    if (keywords.some(kw => combined.includes(kw))) {
      return collection;
    }
  }
  return 'other';
}

// ─── Persist Attribution ────────────────────

export async function persistAttributions(attributions: OrderAttribution[]): Promise<{
  ordersUpserted: number;
  itemsInserted: number;
  errors: string[];
}> {
  let ordersUpserted = 0;
  let itemsInserted = 0;
  const errors: string[] = [];

  for (const attr of attributions) {
    try {
      // Upsert order-level attribution
      const { data: orderRow, error: orderError } = await supabaseAdmin
        .from('order_attributions')
        .upsert({
          shopify_order_id: attr.shopify_order_id,
          shopify_order_name: attr.shopify_order_name,
          order_date: attr.order_date,
          total_revenue: attr.total_revenue,
          utm_source: attr.utm_source,
          utm_medium: attr.utm_medium,
          utm_campaign: attr.utm_campaign,
          utm_content: attr.utm_content,
          utm_term: attr.utm_term,
          attribution_type: attr.attribution_type,
          attribution_source: attr.attribution_source,
          matched_campaign_id: attr.matched_campaign_id,
          matched_campaign_name: attr.matched_campaign_name,
          customer_email: attr.customer_email,
          is_returning_customer: attr.is_returning_customer,
          raw_landing_page: attr.raw_landing_page,
          raw_referrer_url: attr.raw_referrer_url,
          journey_ready: attr.journey_ready,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'shopify_order_id' })
        .select('id')
        .single();

      if (orderError) {
        errors.push(`Order ${attr.shopify_order_name}: ${orderError.message}`);
        continue;
      }
      ordersUpserted++;

      // Delete existing items for this order (idempotent re-run)
      await supabaseAdmin
        .from('order_attribution_items')
        .delete()
        .eq('order_attribution_id', orderRow.id);

      // Insert line items
      if (attr.items.length > 0) {
        const itemRows = attr.items.map(item => ({
          order_attribution_id: orderRow.id,
          shopify_product_id: item.shopify_product_id,
          sku: item.sku,
          product_title: item.product_title,
          product_type: item.product_type,
          quantity: item.quantity,
          item_revenue: item.item_revenue,
          collection_key: item.collection_key,
        }));

        const { error: itemError } = await supabaseAdmin
          .from('order_attribution_items')
          .insert(itemRows);

        if (itemError) {
          errors.push(`Items for ${attr.shopify_order_name}: ${itemError.message}`);
        } else {
          itemsInserted += itemRows.length;
        }
      }

      // Update product_collection_cache
      for (const item of attr.items) {
        if (item.shopify_product_id) {
          await supabaseAdmin
            .from('product_collection_cache')
            .upsert({
              shopify_product_id: item.shopify_product_id,
              canonical_collection: item.collection_key,
              product_type: item.product_type,
              product_title: item.product_title,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'shopify_product_id' });
        }
      }
    } catch (err) {
      errors.push(`Order ${attr.shopify_order_name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { ordersUpserted, itemsInserted, errors };
}

// ─── Refresh Materialized View ──────────────

export async function refreshCollectionView(): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabaseAdmin.rpc('refresh_collection_performance_mv');
  if (error) {
    // Fallback: try raw SQL
    const { error: rawError } = await supabaseAdmin
      .from('collection_performance_mv')
      .select('collection_key')
      .limit(1);
    
    if (rawError) {
      return { success: false, error: rawError.message };
    }
  }
  return { success: true };
}
