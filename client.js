window.__ModuleLoader__.load({
  id: '@sparkfuture/dsh-tailscale-link',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const NS = 'dshTailscaleLink'
    const STATE_PATH = '/api/dsh-tailscale-link/state'

    const en = {
      title: 'Tailscale URL',
      copy: 'Copy',
      copied: 'Copied',
      showQr: 'Show QR',
      hideQr: 'Hide QR',
      refresh: 'Refresh',
      loading: 'Reading…',
      starting: 'Not published yet',
      failed: 'Could not read the URL',
      unreachable: 'The remote link is unavailable right now.',
      note: 'Scanning this signs a phone in. The link carries a login token, so do not show it in public.',
    }
    const zh = {
      title: 'Tailscale 遠端網址',
      copy: '複製',
      copied: '已複製',
      showQr: '顯示 QR',
      hideQr: '收起 QR',
      refresh: '重新整理',
      loading: '讀取中…',
      starting: '尚未發佈',
      failed: '讀不到網址',
      unreachable: '目前沒有可用的遠端網址。',
      note: '掃描即可讓手機登入。這個連結帶著登入憑證，請勿在公開場合展示。',
    }

    const styles = {
      row: {
        display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
        padding: '10px 0', width: '100%',
      },
      label: { color: 'var(--dsw-alias-label-primary)', fontSize: '14px', minWidth: '116px' },
      url: {
        flex: '1 1 220px', minWidth: 0,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '12px',
        color: 'var(--dsw-alias-label-secondary)',
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '8px',
        padding: '6px 10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      },
      button: {
        font: 'inherit', fontSize: '12px', padding: '5px 10px', borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent',
        color: 'var(--dsw-alias-label-primary)', cursor: 'pointer',
      },
      muted: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' },
      error: { color: 'var(--dsw-alias-state-error-primary)', fontSize: '12px' },
      qrWrap: { width: '100%', display: 'flex', gap: '14px', alignItems: 'flex-start', padding: '2px 0 10px' },
      qrBox: {
        background: '#fff', padding: '8px', borderRadius: '10px', lineHeight: 0,
        border: '1px solid var(--dsw-alias-border-l1)',
      },
      note: {
        color: 'var(--dsw-alias-label-secondary)', fontSize: '12px',
        margin: 0, maxWidth: '260px', lineHeight: 1.55,
      },
    }

    /** One settings row: current URL, copy, and an opt-in QR. */
    function makeRow(t) {
      return function TailscaleLinkRow() {
        const [state, setState] = useState({ status: 'loading' })
        const [showQr, setShowQr] = useState(false)
        const [copied, setCopied] = useState(false)
        const timer = useRef(null)

        const load = useCallback(() => {
          setState({ status: 'loading' })
          fetch(STATE_PATH, { cache: 'no-store', credentials: 'same-origin' })
            .then((response) => {
              if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
              return response.json()
            })
            .then((data) => { setState({ status: 'ready', data }) })
            .catch(() => { setState({ status: 'failed' }) })
        }, [])

        useEffect(() => { load() }, [load])
        useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current) }, [])

        const data = state.status === 'ready' ? state.data : null
        const ready = data !== null && data.ok === true
        const url = ready ? data.primaryUrl : null

        const copy = async () => {
          if (url === null) return
          try {
            await navigator.clipboard.writeText(url)
            setCopied(true)
            if (timer.current !== null) clearTimeout(timer.current)
            timer.current = setTimeout(() => { setCopied(false) }, 1500)
          } catch {
            setState((previous) => ({ ...previous, copyFailed: true }))
          }
        }

        const button = (label, onClick, extra) => h('button', {
          type: 'button', onClick, style: { ...styles.button, ...(extra ?? {}) },
        }, label)

        const children = [h('span', { key: 'label', style: styles.label }, t('title'))]

        if (state.status === 'loading') {
          children.push(h('span', { key: 'loading', style: styles.muted }, t('loading')))
        } else if (state.status === 'failed') {
          children.push(h('span', { key: 'failed', style: styles.error }, t('failed')))
          children.push(button(t('refresh'), load, { marginLeft: 'auto' }))
        } else if (!ready) {
          children.push(h('span', { key: 'unavailable', style: styles.muted }, t('starting')))
          children.push(button(t('refresh'), load, { marginLeft: 'auto' }))
        } else {
          children.push(h('span', {
            key: 'url', style: styles.url, title: url, 'data-testid': 'tailscale-link-url',
          }, url))
          children.push(button(copied ? t('copied') : t('copy'), () => { void copy() }))
          children.push(button(showQr ? t('hideQr') : t('showQr'), () => { setShowQr((value) => !value) }))
          children.push(button(t('refresh'), load))
        }

        const rows = [h('div', { key: 'row', style: styles.row }, children)]

        if (showQr && ready && typeof data.qrSvg === 'string') {
          rows.push(h('div', { key: 'qr', style: styles.qrWrap }, [
            h('div', {
              key: 'box', style: styles.qrBox,
              dangerouslySetInnerHTML: { __html: data.qrSvg },
            }),
            h('p', { key: 'note', style: styles.note }, t('note')),
          ]))
        }

        return h('div', null, rows)
      }
    }

    /** Keep one broken render from removing the row silently. */
    class RowBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }

      static getDerivedStateFromError() {
        return { failed: true }
      }

      render() {
        if (this.state.failed) {
          return h('div', { style: { ...styles.row, color: 'var(--dsw-alias-state-error-primary)', fontSize: '12px' } },
            this.props.label, ' — ', this.props.message)
        }
        return this.props.children
      }
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-tailscale-link: dictionaries')
        const t = ctx.locale.bind(NS)
        const Row = makeRow(t)
        const row = function GuardedTailscaleLinkRow() {
          return h(RowBoundary, { label: t('title'), message: t('failed') }, h(Row))
        }
        ctx.slots.inject('settings.general.item', () => ctx.slots.register({
          name: 'settings.general.item',
          id: '@sparkfuture/dsh-tailscale-link',
          order: 96,
        }, row))
      },
    }
  },
})
