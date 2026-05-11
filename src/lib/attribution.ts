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
  
  customer_email_hash: string | null;
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

async function hashEmail(email: string | null | undefined): Promise<string | null> {
  if (!email) return null;
  const encoder = new TextEncoder();
  const data = encoder.encode(email.toLowerCase().trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Build Campaign Lookup ──────────────────

export async function buildCampaignLookup(
  campaignIds: string[],
  candidateNames: string[] = []
): Promise<CampaignLookup> {
  const idSet = new Set<string>();
  const nameMap = new Map<string, string[]>();
  const nameSet = new Set<string>();
  const idToName = new Map<string, string>();

  const CHUNK = 100;

  // Step 1: Fetch campaigns by ID (from utm_campaign values)
  const uniqueIds = [...new Set(campaignIds)];
  for (let i = 0; i < uniqueIds.length; i += CHUNK) {
    const chunk = uniqueIds.slice(i, i + CHUNK);
    const { data } = await supabaseAdmin
      .from('campaign_snapshots')
      .select('campaign_id, campaign_name')
      .in('campaign_id', chunk);

    for (const c of data || []) {
      addCampaignToLookup(c, idSet, nameMap, nameSet, idToName);
    }
  }

  // Step 2: Fetch campaigns by name (from utm_source values)
  // This aligns sync coverage with the audit endpoint (TKT-00240 P1-3)
  const uniqueNames = [...new Set(candidateNames)].filter(n => n && !nameSet.has(n));
  if (uniqueNames.length > 0) {
    // Fetch all recent campaigns for name matching (same strategy as audit endpoint)
    // Since PostgREST .in() fails with commas in values, fetch a bounded recent set
    const { data: nameCampaigns } = await supabaseAdmin
      .from('campaign_snapshots')
      .select('campaign_id, campaign_name')
      .order('snapshot_date', { ascending: false })
      .limit(10000);

    for (const c of nameCampaigns || []) {
      addCampaignToLookup(c, idSet, nameMap, nameSet, idToName);
    }
  }

  return { idSet, nameMap, nameSet, idToName };
}

function addCampaignToLookup(
  c: { campaign_id: string; campaign_name: string },
  idSet: Set<string>,
  nameMap: Map<string, string[]>,
  nameSet: Set<string>,
  idToName: Map<string, string>
): void {
  const cid = String(c.campaign_id);
  idSet.add(cid);
  if (!idToName.has(cid)) {
    idToName.set(cid, c.campaign_name);
  }
  const norm = normalize(c.campaign_name);
  if (norm) {
    nameSet.add(norm);
    if (!nameMap.has(norm)) nameMap.set(norm, []);
    const ids = nameMap.get(norm)!;
    if (!ids.includes(cid)) ids.push(cid);
  }
}

// ─── Attribute Single Order ─────────────────

export async function attributeOrder(
  order: ShopifyOrderForAttribution,
  lookup: CampaignLookup,
  collectionCache: Map<string, string>
): Promise<OrderAttribution> {
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
    customer_email_hash: await hashEmail(order.customer?.email),
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

// ─── Persist Attribution (Batch Optimized) ──

export async function persistAttributions(attributions: OrderAttribution[]): Promise<{
  ordersUpserted: number;
  itemsInserted: number;
  errors: string[];
}> {
  let ordersUpserted = 0;
  let itemsInserted = 0;
  const errors: string[] = [];

  if (attributions.length === 0) return { ordersUpserted, itemsInserted, errors };

  // Step 1: Batch upsert all order-level attributions
  const orderRows = attributions.map(attr => ({
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
    customer_email_hash: attr.customer_email_hash,
    is_returning_customer: attr.is_returning_customer,
    raw_landing_page: attr.raw_landing_page,
    raw_referrer_url: attr.raw_referrer_url,
    journey_ready: attr.journey_ready,
    updated_at: new Date().toISOString(),
  }));

  // Batch upsert in chunks of 100
  const CHUNK = 100;
  for (let i = 0; i < orderRows.length; i += CHUNK) {
    const chunk = orderRows.slice(i, i + CHUNK);
    const { error } = await supabaseAdmin
      .from('order_attributions')
      .upsert(chunk, { onConflict: 'shopify_order_id' });
    
    if (error) {
      errors.push(`Batch orders ${i}-${i + chunk.length}: ${error.message}`);
    } else {
      ordersUpserted += chunk.length;
    }
  }

  // Step 2: Fetch all order IDs we just upserted (to link items)
  const orderIds = attributions.map(a => a.shopify_order_id);
  const { data: savedOrders } = await supabaseAdmin
    .from('order_attributions')
    .select('id, shopify_order_id')
    .in('shopify_order_id', orderIds);

  if (!savedOrders || savedOrders.length === 0) {
    errors.push('Failed to fetch saved order IDs for item linking');
    return { ordersUpserted, itemsInserted, errors };
  }

  const orderIdMap = new Map<string, string>();
  for (const o of savedOrders) {
    orderIdMap.set(o.shopify_order_id, o.id);
  }

  // Step 3: Delete existing items for all these orders (idempotent)
  const dbOrderIds = savedOrders.map(o => o.id);
  for (let i = 0; i < dbOrderIds.length; i += CHUNK) {
    const chunk = dbOrderIds.slice(i, i + CHUNK);
    await supabaseAdmin
      .from('order_attribution_items')
      .delete()
      .in('order_attribution_id', chunk);
  }

  // Step 4: Batch insert all line items
  const allItemRows: Record<string, unknown>[] = [];
  const allCacheRows: Record<string, unknown>[] = [];
  const seenProducts = new Set<string>();

  for (const attr of attributions) {
    const dbId = orderIdMap.get(attr.shopify_order_id);
    if (!dbId) continue;

    for (const item of attr.items) {
      allItemRows.push({
        order_attribution_id: dbId,
        shopify_product_id: item.shopify_product_id,
        sku: item.sku,
        product_title: item.product_title,
        product_type: item.product_type,
        quantity: item.quantity,
        item_revenue: item.item_revenue,
        collection_key: item.collection_key,
      });

      // Deduplicated cache entries
      if (item.shopify_product_id && !seenProducts.has(item.shopify_product_id)) {
        seenProducts.add(item.shopify_product_id);
        allCacheRows.push({
          shopify_product_id: item.shopify_product_id,
          canonical_collection: item.collection_key,
          product_type: item.product_type,
          product_title: item.product_title,
          updated_at: new Date().toISOString(),
        });
      }
    }
  }

  // Insert items in chunks
  for (let i = 0; i < allItemRows.length; i += CHUNK) {
    const chunk = allItemRows.slice(i, i + CHUNK);
    const { error } = await supabaseAdmin
      .from('order_attribution_items')
      .insert(chunk);
    
    if (error) {
      errors.push(`Batch items ${i}-${i + chunk.length}: ${error.message}`);
    } else {
      itemsInserted += chunk.length;
    }
  }

  // Step 5: Batch upsert product collection cache
  for (let i = 0; i < allCacheRows.length; i += CHUNK) {
    const chunk = allCacheRows.slice(i, i + CHUNK);
    await supabaseAdmin
      .from('product_collection_cache')
      .upsert(chunk, { onConflict: 'shopify_product_id' });
  }

  return { ordersUpserted, itemsInserted, errors };
}
