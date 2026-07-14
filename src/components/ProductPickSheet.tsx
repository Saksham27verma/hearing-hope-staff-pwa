import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import type { CatalogProduct } from '../api/staffProductsCatalog';
import type { StaffInventoryRow } from '../api/staffInventory';
import styles from './ProductPickSheet.module.css';

type CatalogMode = {
  kind: 'catalog';
  title: string;
  subtitle?: string;
  items: CatalogProduct[];
  /** Already-chosen products (kept even if not in current search results). */
  knownItems?: CatalogProduct[];
  loading?: boolean;
  selectedIds: string[];
  maxSelect?: number;
  onSearch: (q: string) => void;
  search: string;
  onConfirm: (selected: CatalogProduct[]) => void;
  onClose: () => void;
};

type StockMode = {
  kind: 'stock';
  title: string;
  subtitle?: string;
  items: StaffInventoryRow[];
  loading?: boolean;
  selectedLineIds: string[];
  /** Serials already on the form — shown but not selectable again. */
  disabledLineIds?: string[];
  /** Limit to rows matching these catalog product ids (optional). */
  filterProductIds?: string[];
  maxSelect?: number;
  onSearch: (q: string) => void;
  search: string;
  onConfirm: (selected: StaffInventoryRow[]) => void;
  onClose: () => void;
};

export type ProductPickSheetProps = CatalogMode | StockMode;

export default function ProductPickSheet(props: ProductPickSheetProps) {
  const knownRef = useRef<Map<string, CatalogProduct | StaffInventoryRow>>(new Map());

  const [localSelected, setLocalSelected] = useState<Set<string>>(
    () =>
      new Set(props.kind === 'catalog' ? props.selectedIds : props.selectedLineIds)
  );

  useEffect(() => {
    setLocalSelected(
      new Set(props.kind === 'catalog' ? props.selectedIds : props.selectedLineIds)
    );
  }, [
    props.kind,
    props.kind === 'catalog' ? props.selectedIds.join('|') : props.selectedLineIds.join('|'),
  ]);

  useEffect(() => {
    if (props.kind === 'catalog') {
      for (const p of props.knownItems || []) knownRef.current.set(p.id, p);
      for (const p of props.items) knownRef.current.set(p.id, p);
    } else {
      for (const r of props.items) knownRef.current.set(r.lineId, r);
    }
  }, [props]);

  const filteredStock = useMemo(() => {
    if (props.kind !== 'stock') return [];
    let rows = props.items;
    if (props.filterProductIds?.length) {
      const allow = new Set(props.filterProductIds);
      rows = rows.filter((r) => allow.has(r.productId));
    }
    const q = props.search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.company.toLowerCase().includes(q) ||
        r.type.toLowerCase().includes(q) ||
        r.serialNumber.toLowerCase().includes(q)
    );
  }, [props]);

  const disabledSet = useMemo(() => {
    if (props.kind !== 'stock') return new Set<string>();
    return new Set(props.disabledLineIds || []);
  }, [props]);

  const toggle = (id: string) => {
    if (disabledSet.has(id)) return;
    setLocalSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      const max = props.maxSelect ?? Infinity;
      if (next.size >= max) {
        if (max === 1) {
          return new Set([id]);
        }
        return prev;
      }
      next.add(id);
      return next;
    });
  };

  const confirm = () => {
    if (props.kind === 'catalog') {
      const selected: CatalogProduct[] = [];
      for (const id of localSelected) {
        const hit = knownRef.current.get(id) as CatalogProduct | undefined;
        if (hit) selected.push(hit);
      }
      props.onConfirm(selected);
    } else {
      const selected: StaffInventoryRow[] = [];
      for (const id of localSelected) {
        if (disabledSet.has(id)) continue;
        const hit = knownRef.current.get(id) as StaffInventoryRow | undefined;
        if (hit) selected.push(hit);
      }
      props.onConfirm(selected);
    }
  };

  const count = localSelected.size;
  const max = props.maxSelect;

  return (
    <div className={styles.backdrop} role="presentation" onClick={props.onClose}>
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.handle} aria-hidden />
        <header className={styles.header}>
          <div className={styles.headerText}>
            <h2 className={styles.title}>{props.title}</h2>
            {props.subtitle ? <p className={styles.subtitle}>{props.subtitle}</p> : null}
          </div>
          <button type="button" className={styles.closeBtn} onClick={props.onClose} aria-label="Close">
            <X size={22} strokeWidth={2} />
          </button>
        </header>

        <div className={styles.searchWrap}>
          <Search size={18} className={styles.searchIcon} strokeWidth={2} />
          <input
            className={styles.searchInput}
            placeholder={
              props.kind === 'stock' ? 'Search name, company, serial…' : 'Search company or model…'
            }
            value={props.search}
            onChange={(e) => props.onSearch(e.target.value)}
            autoFocus
          />
        </div>

        <div className={styles.metaBar}>
          <span>
            {count} selected
            {max != null && Number.isFinite(max) ? ` · max ${max}` : ''}
          </span>
          {props.loading ? <span>Loading…</span> : null}
        </div>

        <div className={styles.list}>
          {props.kind === 'catalog'
            ? props.items.map((p) => {
                const on = localSelected.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`${styles.card} ${on ? styles.cardOn : ''}`}
                    onClick={() => toggle(p.id)}
                  >
                    <span className={`${styles.check} ${on ? styles.checkOn : ''}`}>
                      {on ? <Check size={16} strokeWidth={3} /> : null}
                    </span>
                    <span className={styles.cardBody}>
                      <span className={styles.cardName}>{p.name}</span>
                      <span className={styles.cardMeta}>
                        {p.company || '—'} · {p.type || '—'}
                      </span>
                      <span className={styles.cardPrice}>MRP ₹{p.mrp ?? 0}</span>
                    </span>
                  </button>
                );
              })
            : filteredStock.map((r) => {
                const on = localSelected.has(r.lineId);
                const disabled = disabledSet.has(r.lineId);
                return (
                  <button
                    key={r.lineId}
                    type="button"
                    className={`${styles.card} ${on ? styles.cardOn : ''} ${disabled ? styles.cardDisabled : ''}`}
                    onClick={() => toggle(r.lineId)}
                    disabled={disabled}
                  >
                    <span className={`${styles.check} ${on || disabled ? styles.checkOn : ''}`}>
                      {on || disabled ? <Check size={16} strokeWidth={3} /> : null}
                    </span>
                    <span className={styles.cardBody}>
                      <span className={styles.cardName}>{r.name}</span>
                      <span className={styles.cardMeta}>
                        {r.company || '—'} · {r.type || '—'}
                        {disabled ? ' · already added' : ''}
                      </span>
                      <span className={styles.serialPill}>SN {r.serialNumber}</span>
                      <span className={styles.cardPrice}>MRP ₹{r.mrp}</span>
                    </span>
                  </button>
                );
              })}
          {props.kind === 'catalog' && !props.loading && props.items.length === 0 ? (
            <p className={styles.empty}>No products found. Try another search.</p>
          ) : null}
          {props.kind === 'stock' && !props.loading && filteredStock.length === 0 ? (
            <p className={styles.empty}>No stock matches. Try another search.</p>
          ) : null}
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.secondaryBtn} onClick={props.onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.primaryBtn}
            disabled={count === 0}
            onClick={confirm}
          >
            Add {count > 0 ? `(${count})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
