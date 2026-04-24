"use client";

import React, { useState, useEffect } from 'react';
import { Header, PageContainer } from '@/components/layout';
import { apiHeaders } from '@/hooks/useApi';

export default function ShopifyAuthPage() {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    // Read URL params manually on mount to avoid NextJS router strictness
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const shop = params.get('shop') || 'frenzidea.myshopify.com';
    
    // Retrieve stored credentials from localStorage
    const clientId = localStorage.getItem('shopify_client_id');
    const clientSecret = localStorage.getItem('shopify_client_secret');

    if (code && clientId && clientSecret && shop) {
      // Exchange code for token (Calling from client is fine for temporary auth, though strictly Shopify expects server-to-server. Assuming CORS allows it or hitting our own proxy)
      // Actually, hitting Shopify from client MIGHT throw CORS. We'll use a local API route to proxy.
      fetch('/api/shopify/exchange', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ shop, code, clientId, clientSecret })
      })
      .then(res => res.json())
      .then(data => {
        if (data.access_token) {
          setAccessToken(data.access_token);
          // Clean up
          localStorage.removeItem('shopify_client_id');
          localStorage.removeItem('shopify_client_secret');
          window.history.replaceState({}, '', '/shopify-auth');
        } else {
          setErrorMsg(data.error || 'Failed to exchange token');
        }
      })
      .catch(err => setErrorMsg(String(err)));
    }
  }, []);

  const handleStartAuth = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const clientId = fd.get('client_id') as string;
    const secret = fd.get('clientSecret') as string;
    const shop = fd.get('shop') as string || 'frenzidea.myshopify.com';
    
    // Save to localStorage so we can use them after Shopify redirects back
    localStorage.setItem('shopify_client_id', clientId);
    localStorage.setItem('shopify_client_secret', secret);
    
    const redirectUri = `http://localhost:3000/shopify-auth`;
    
    // Redirect to Shopify
    window.location.href = `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=read_orders,read_products,read_customers&redirect_uri=${encodeURIComponent(redirectUri)}`;
  };

  return (
    <>
      <Header title="Shopify OAuth Assistant" subtitle="Công cụ sinh tự động Admin API Access Token (shpat_...)" />
      <PageContainer>
        <div className="card" style={{ maxWidth: 800, margin: '0 auto' }}>
          
          {accessToken ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
              <h2 style={{ color: 'var(--color-winner)', marginBottom: 'var(--space-md)' }}>✅ Lấy mã thành công!</h2>
              <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-md)' }}>
                Đây là vĩnh viễn Shopify Admin API Access Token của anh. Hãy copy và dán mã này vào trang Settings của AdPilot.
              </p>
              <div style={{ background: 'var(--bg-tertiary)', padding: 'var(--space-md)', borderRadius: 'var(--radius-md)', fontSize: '20px', fontFamily: 'monospace', color: 'var(--text-primary)', border: '1px solid var(--border-primary)', wordBreak: 'break-all' }}>
                {accessToken}
              </div>
              <div style={{ marginTop: 'var(--space-lg)' }}>
                <a href="/settings" className="btn btn-primary">Quay lại cài đặt</a>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              {errorMsg && (
                <div style={{ padding: 'var(--space-sm)', background: 'rgba(255,59,48,0.1)', color: 'var(--color-kill)', borderRadius: 'var(--radius-sm)' }}>
                  ❌ Lỗi: {errorMsg}
                </div>
              )}
              
              <p style={{ color: 'var(--text-muted)' }}>
                Hãy điền Client ID và Client Secret từ bảng Dev Dashboard của Shopify vào đây. Hệ thống sẽ tự động chuyển hướng anh sang Shopify để cấp quyền, rồi trả về mã <code style={{color: 'var(--color-primary)'}}>shpat_</code>.
              </p>
              <div style={{ padding: 'var(--space-sm)', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-warning)' }}>
                <strong style={{color: 'var(--color-warning)'}}>⚠️ LƯU Ý QUAN TRỌNG:</strong> Anh phải điền <code>http://localhost:3000/shopify-auth</code> vào mục <strong>Allowed redirection URI(s)</strong> trong trang Configuration của Shopify App trước khi bấm nút.
              </div>

              <form onSubmit={handleStartAuth} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', marginTop: 'var(--space-sm)' }}>
                <div className="form-group">
                  <label className="form-label">Client ID</label>
                  <input className="form-input" name="client_id" required placeholder="Ví dụ: 2b896c4549..." />
                </div>
                
                <div className="form-group">
                  <label className="form-label">Client Secret</label>
                  <input className="form-input" type="password" name="clientSecret" required placeholder="Bấm nút con mắt trên Shopify copy dán vào đây" />
                </div>

                <div className="form-group">
                  <label className="form-label">Store Domain</label>
                  <input className="form-input" name="shop" defaultValue="frenzidea.myshopify.com" />
                </div>

                <button type="submit" className="btn btn-primary">
                  Lấy Mã Tự Động
                </button>
              </form>
            </div>
          )}
        </div>
      </PageContainer>
    </>
  );
}
