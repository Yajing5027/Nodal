// ============================================================
// ImageManager — asset list with thumbnails, editable descriptions,
// delete, and file-upload. Images are stored as Asset blobs in Dexie,
// NEVER as base64 in markdown.
// ============================================================
import { useState, useEffect, useRef, useCallback } from 'react';
import type { KnowledgeNode, KnowledgeAsset, ID } from '../../domain/types';
import {
  getAssetsByIds,
  createAsset,
  updateAsset,
  deleteAsset,
  assetToUrl,
} from '../../repositories/assetRepository';

interface ImageManagerProps {
  node: KnowledgeNode;
  onAssetsChange: (assetIds: ID[]) => void;
  onInsertInNote?: (assetId: ID, filename: string, description?: string) => void;
}

export function ImageManager({ node, onAssetsChange, onInsertInNote }: ImageManagerProps) {
  const [assets, setAssets] = useState<KnowledgeAsset[]>([]);
  const [thumbnails, setThumbnails] = useState<Map<ID, string>>(new Map());
  const [descDrafts, setDescDrafts] = useState<Map<ID, string>>(new Map());
  const descTimeouts = useRef<Map<ID, ReturnType<typeof setTimeout>>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch assets whenever node.assetIds changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await getAssetsByIds(node.assetIds);
      if (cancelled) return;
      // Preserve order from node.assetIds
      const ordered = node.assetIds
        .map((id) => list.find((a) => a.id === id))
        .filter((a): a is KnowledgeAsset => Boolean(a));
      setAssets(ordered);
      // Initialize description drafts
      const drafts = new Map<ID, string>();
      for (const a of ordered) drafts.set(a.id, a.description);
      setDescDrafts(drafts);
    })();
    return () => { cancelled = true; };
  }, [node.assetIds.join(',')]);

  // Create + revoke thumbnail object URLs
  useEffect(() => {
    const urls = new Map<ID, string>();
    for (const asset of assets) {
      urls.set(asset.id, assetToUrl(asset));
    }
    setThumbnails(urls);
    return () => {
      for (const url of urls.values()) {
        URL.revokeObjectURL(url);
      }
    };
  }, [assets]);

  // Clean up description debounce timeouts on unmount
  useEffect(() => {
    const timeouts = descTimeouts.current;
    return () => {
      for (const t of timeouts.values()) clearTimeout(t);
      timeouts.clear();
    };
  }, []);

  const handleFileSelect = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const newIds: ID[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue;
        const asset = await createAsset({
          filename: file.name,
          mimeType: file.type,
          blob: file,
          description: '',
        });
        newIds.push(asset.id);
      }
      if (newIds.length > 0) {
        onAssetsChange([...node.assetIds, ...newIds]);
      }
    },
    [node.assetIds, onAssetsChange]
  );

  const handleDelete = useCallback(
    async (assetId: ID) => {
      await deleteAsset(assetId);
      // deleteAsset removes the reference from all nodes; update local list
      onAssetsChange(node.assetIds.filter((id) => id !== assetId));
    },
    [node.assetIds, onAssetsChange]
  );

  const handleDescriptionChange = useCallback(
    (assetId: ID, value: string) => {
      setDescDrafts((prev) => new Map(prev).set(assetId, value));
      // Debounce 500ms → updateAsset
      const existing = descTimeouts.current.get(assetId);
      if (existing) clearTimeout(existing);
      const t = setTimeout(() => {
        updateAsset(assetId, { description: value });
        descTimeouts.current.delete(assetId);
      }, 500);
      descTimeouts.current.set(assetId, t);
    },
    []
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {/* Upload button */}
      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            handleFileSelect(e.target.files);
            e.target.value = '';
          }}
        />
        <button onClick={() => fileInputRef.current?.click()} style={{ width: '100%' }}>
          + Add Image
        </button>
      </div>

      {/* Asset list */}
      {assets.length === 0 ? (
        <span style={{ fontSize: 'var(--font-xs)', color: 'var(--text-faint)' }}>
          No images attached
        </span>
      ) : (
        assets.map((asset) => {
          const thumb = thumbnails.get(asset.id);
          const desc = descDrafts.get(asset.id) ?? '';
          const isUsedInNote = (node.contentMarkdown || '').includes(`asset://${asset.id}`) || (node.contentMarkdown || '').includes(asset.id);
          return (
            <div
              key={asset.id}
              style={{
                display: 'flex',
                gap: 'var(--space-3)',
                padding: 'var(--space-2)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--surface-secondary)',
              }}
            >
              {/* Thumbnail */}
              <div
                style={{
                  width: 64,
                  height: 64,
                  flexShrink: 0,
                  borderRadius: 'var(--radius-sm)',
                  overflow: 'hidden',
                  background: 'var(--surface-tertiary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {thumb ? (
                  <img
                    src={thumb}
                    alt={asset.description || asset.filename}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <span style={{ fontSize: 'var(--font-xs)', color: 'var(--text-faint)' }}>…</span>
                )}
              </div>

              {/* Details */}
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 'var(--space-2)',
                  }}
                >
                  <span
                    style={{
                      fontSize: 'var(--font-xs)',
                      color: 'var(--text-secondary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontWeight: 500,
                    }}
                    title={asset.filename}
                  >
                    {asset.filename}
                  </span>
                  {isUsedInNote ? (
                    <span
                      style={{
                        fontSize: '10px',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        background: 'rgba(52, 168, 83, 0.15)',
                        color: 'var(--color-success, #1e8e3e)',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Used in note
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: '10px',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        background: 'rgba(249, 171, 0, 0.15)',
                        color: 'var(--color-warning, #e37400)',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Attachment only
                    </span>
                  )}
                </div>
                <textarea
                  value={desc}
                  onChange={(e) => handleDescriptionChange(asset.id, e.target.value)}
                  placeholder="Describe this image…"
                  rows={2}
                  style={{
                    fontSize: 'var(--font-xs)',
                    resize: 'vertical',
                    minHeight: 36,
                  }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: '2px' }}>
                  {!isUsedInNote && onInsertInNote && (
                    <button
                      type="button"
                      className="primary-outline"
                      onClick={() => onInsertInNote(asset.id, asset.filename, desc)}
                      style={{ fontSize: 'var(--font-xs)', padding: '2px 8px' }}
                    >
                      Insert in note ↵
                    </button>
                  )}
                  <button
                    className="danger ghost"
                    onClick={() => handleDelete(asset.id)}
                    style={{ fontSize: 'var(--font-xs)', padding: '2px 6px' }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
