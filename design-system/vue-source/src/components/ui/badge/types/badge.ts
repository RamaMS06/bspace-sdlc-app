/**
 * Props untuk komponen BBadge.
 * Dokumentasi ini muncul saat hover di <BBadge> atau di setiap prop (label, variant, reverse, block).
 *
 * @example
 * <BBadge label="Sukses" variant="success" />
 * <BBadge variant="draft" reverse block />
 */
export interface BadgeProps {
  /**
   * Teks yang ditampilkan di dalam badge.
   * @default 'Badge'
   */
  label?: string
  /**
   * Gaya/status badge: success | waiting | draft | revise | reject | neutral.
   * @default 'success'
   */
  variant?: 'success' | 'waiting' | 'draft' | 'revise' | 'reject' | 'neutral'
  /**
   * Jika true, warna teks dan background dibalik.
   * @default false
   */
  reverse?: boolean
  /**
   * Jika true, badge memenuhi lebar (display block).
   * @default false
   */
  block?: boolean
}
