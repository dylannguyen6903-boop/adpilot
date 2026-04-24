"""Sanitize internal error messages in API routes."""
import os

api_dir = r'd:\Crypto\70_Projects\adpilot\src\app\api'
skip_dirs = ['test-ai', 'chat']

replacements = [
    ('`Shopify sync failed: ${error instanceof Error ? error.message : String(error)}`',
     "'Shopify sync failed. Check credentials in Settings.'"),
    ('`Failed to save profile: ${error instanceof Error ? error.message : String(error)}`',
     "'Failed to save profile.'"),
    ('`Failed to save connections: ${error instanceof Error ? error.message : String(error)}`',
     "'Failed to save connections.'"),
    ('`Failed to fetch analytics: ${error instanceof Error ? error.message : String(error)}`',
     "'Failed to load analytics.'"),
    ('`Facebook sync failed: ${error instanceof Error ? error.message : String(error)}`',
     "'Facebook sync failed. Check credentials in Settings.'"),
    ('`Failed to fetch insights: ${error instanceof Error ? error.message : String(error)}`',
     "'Failed to load insights.'"),
    ('`Failed to fetch campaigns: ${error instanceof Error ? error.message : String(error)}`',
     "'Failed to load campaigns.'"),
    ('`Plan generation failed: ${error instanceof Error ? error.message : String(error)}`',
     "'Plan generation failed.'"),
    ('`Margin calculation failed: ${error instanceof Error ? error.message : String(error)}`',
     "'Margin calculation failed.'"),
    ('`Goal calculation failed: ${error instanceof Error ? error.message : String(error)}`',
     "'Goal calculation failed.'"),
    ('`Classification failed: ${error instanceof Error ? error.message : String(error)}`',
     "'Classification failed.'"),
    ('`Brief generation failed: ${error instanceof Error ? error.message : String(error)}`',
     "'Brief generation failed.'"),
    ('`Budget allocation failed: ${error instanceof Error ? error.message : String(error)}`',
     "'Budget allocation failed.'"),
    ('`Simulation failed: ${error instanceof Error ? error.message : String(error)}`',
     "'Simulation failed.'"),
]

count = 0
for root, dirs, files in os.walk(api_dir):
    for f in files:
        if f != 'route.ts':
            continue
        if any(s in root.replace('\\', '/') for s in skip_dirs):
            continue
        path = os.path.join(root, f)
        with open(path, 'r', encoding='utf-8') as fh:
            content = fh.read()
        original = content
        for old, new in replacements:
            if old in content:
                content = content.replace(old, new)
                count += 1
        if content != original:
            with open(path, 'w', encoding='utf-8') as fh:
                fh.write(content)
            print(f'Updated: {os.path.relpath(path, api_dir)}')

print(f'Total replacements: {count}')
