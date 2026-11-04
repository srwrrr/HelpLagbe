import { useCallback, useEffect, useRef, useState } from 'react'

// ---------------------------------------------------------------- formatting

const money = (value) => `৳${Math.round(Number(value) || 0).toLocaleString('en-US')}`
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function monthLabel(key, showYear = false) {
  const [year, month] = String(key).split('-')
  const name = MONTH_NAMES[Number(month) - 1] || key
  return showYear ? `${name} ${String(year).slice(2)}` : name
}

function fullMonthLabel(key) {
  const [year, month] = String(key).split('-')
  return `${MONTH_NAMES[Number(month) - 1] || key} ${year}`
}

function minutesLabel(minutes) {
  if (minutes === null || minutes === undefined) return '-'
  if (minutes < 90) return `${minutes} min`
  if (minutes < 60 * 36) return `${Math.round(minutes / 60)} h`
  return `${Math.round(minutes / 1440)} d`
}

const percentLabel = (value) => (value === null || value === undefined ? '-' : `${value}%`)

// Rounds an axis maximum up to a clean number and returns evenly spaced ticks.
function niceScale(max, tickCount = 4) {
  if (!(max > 0)) return { max: 1, ticks: [0, 1] }
  const rough = max / tickCount
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((multiplier) => multiplier * magnitude).find((candidate) => candidate >= rough)
  const top = Math.ceil(max / step) * step
  const ticks = []
  for (let value = 0; value <= top + step / 2; value += step) ticks.push(Math.round(value * 100) / 100)
  return { max: top, ticks }
}

function compactTick(value) {
  if (value >= 1_000_000) return `${+(value / 1_000_000).toFixed(1)}M`
  if (value >= 10_000) return `${Math.round(value / 1000)}K`
  return value.toLocaleString('en-US')
}

function topRoundedPath(x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, height, width / 2))
  return `M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height} Z`
}

function useElementWidth() {
  const ref = useRef(null)
  const [width, setWidth] = useState(560)
  useEffect(() => {
    const element = ref.current
    if (!element) return undefined
    const update = () => setWidth(Math.max(260, Math.floor(element.getBoundingClientRect().width)))
    update()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

// ---------------------------------------------------------------- building blocks

export function KpiRow({ items }) {
  return <div className="viz-kpis">{items.map((item) => <div className="viz-kpi" key={item.label}><span className="viz-kpi-label">{item.label}</span><strong className="viz-kpi-value">{item.value}</strong>{item.note && <span className="viz-kpi-note">{item.note}</span>}</div>)}</div>
}

export function RangeFilter({ value, onChange }) {
  return <div className="viz-filters" role="radiogroup" aria-label="Time range"><span className="viz-filter-label">Time range</span>{[[3, 'Last 3 months'], [6, 'Last 6 months'], [12, 'Last 12 months']].map(([months, label]) => <button key={months} type="button" role="radio" aria-checked={value === months} className={value === months ? 'viz-chip is-selected' : 'viz-chip'} onClick={() => onChange(months)}>{label}</button>)}</div>
}

function ChartCard({ title, description, children, table }) {
  const [showTable, setShowTable] = useState(false)
  return <section className="viz-card"><header className="viz-card-header"><div><h3>{title}</h3>{description && <p>{description}</p>}</div>{table && <button type="button" className="viz-link" onClick={() => setShowTable((visible) => !visible)} aria-pressed={showTable}>{showTable ? 'View as chart' : 'View as table'}</button>}</header>{showTable && table ? table : children}</section>
}

function DataTable({ caption, columns, rows }) {
  return <div className="viz-table-wrap"><table className="viz-table"><caption className="viz-sr-only">{caption}</caption><thead><tr>{columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row[0]}>{row.map((cell, index) => index === 0 ? <th key={index} scope="row">{cell}</th> : <td key={index}>{cell}</td>)}</tr>)}</tbody></table></div>
}

// Column chart: stacked (parts of one total) or grouped (side by side).
export function ColumnChart({ title, description, data, series, stacked = false, format = (value) => String(value), emptyText = 'Nothing to show for this period yet.' }) {
  const [containerRef, width] = useElementWidth()
  const [active, setActive] = useState(null)
  const height = 230
  const margin = { top: 22, right: 8, bottom: 28, left: 44 }
  const innerWidth = width - margin.left - margin.right
  const innerHeight = height - margin.top - margin.bottom
  const totals = data.map((row) => (stacked ? series.reduce((sum, item) => sum + (row[item.key] || 0), 0) : Math.max(...series.map((item) => row[item.key] || 0))))
  const hasData = totals.some((total) => total > 0)
  const { max, ticks } = niceScale(Math.max(...totals, 0))
  const band = innerWidth / Math.max(data.length, 1)
  const barWidth = stacked ? Math.min(24, band * 0.6) : Math.min(16, (band * 0.7 - (series.length - 1) * 2) / series.length)
  const scale = (value) => (value / max) * innerHeight
  const labelEvery = band < 34 ? 2 : 1
  const showYear = (index) => data[index].label.endsWith('-01') || index === 0
  const activeRow = active === null ? null : data[active]
  // Sit beside the hovered column (not on top of it); flip to the left near the right edge.
  const activeCenter = active === null ? 0 : margin.left + band * (active + 0.5)
  const tooltipOnLeft = activeCenter > width * 0.55
  const tooltipStyle = tooltipOnLeft ? { right: width - activeCenter + band * 0.45, top: 4 } : { left: activeCenter + band * 0.45, top: 4 }

  const table = <DataTable caption={title} columns={['Month', ...series.map((item) => item.label), ...(stacked && series.length > 1 ? ['Total'] : [])]} rows={data.map((row, index) => [fullMonthLabel(row.label), ...series.map((item) => format(row[item.key] || 0)), ...(stacked && series.length > 1 ? [format(totals[index])] : [])])} />

  return <ChartCard title={title} description={description} table={hasData ? table : null}>
    {series.length > 1 && <ul className="viz-legend">{series.map((item) => <li key={item.key}><span className="viz-swatch" style={{ background: item.color }} aria-hidden="true" />{item.label}</li>)}</ul>}
    {!hasData ? <p className="viz-empty">{emptyText}</p> : <div className="viz-plot" ref={containerRef} onPointerLeave={() => setActive(null)}>
      <svg width={width} height={height} role="img" aria-label={`${title}. ${data.map((row, index) => `${fullMonthLabel(row.label)}: ${format(totals[index])}`).join(', ')}`}>
        {ticks.map((tick) => <g key={tick}><line x1={margin.left} x2={width - margin.right} y1={margin.top + innerHeight - scale(tick)} y2={margin.top + innerHeight - scale(tick)} className="viz-grid" /><text x={margin.left - 8} y={margin.top + innerHeight - scale(tick) + 4} textAnchor="end" className="viz-axis-text">{compactTick(tick)}</text></g>)}
        {data.map((row, index) => {
          const center = margin.left + band * (index + 0.5)
          const baseline = margin.top + innerHeight
          const marks = []
          if (stacked) {
            let cumulative = 0
            const present = series.filter((item) => (row[item.key] || 0) > 0)
            present.forEach((item, position) => {
              const segment = scale(row[item.key])
              const gap = position > 0 ? 2 : 0
              const y = baseline - scale(cumulative) - segment
              const h = Math.max(segment - gap, 1)
              const isTop = position === present.length - 1
              marks.push(isTop ? <path key={item.key} d={topRoundedPath(center - barWidth / 2, y, barWidth, h, 4)} fill={item.color} /> : <rect key={item.key} x={center - barWidth / 2} y={y + gap} width={barWidth} height={h} fill={item.color} />)
              cumulative += row[item.key]
            })
          } else {
            const groupWidth = series.length * barWidth + (series.length - 1) * 2
            series.forEach((item, position) => {
              const value = row[item.key] || 0
              if (value <= 0) return
              const x = center - groupWidth / 2 + position * (barWidth + 2)
              marks.push(<path key={item.key} d={topRoundedPath(x, baseline - scale(value), barWidth, scale(value), 4)} fill={item.color} />)
            })
          }
          return <g key={row.label} className={active === index ? 'viz-band is-active' : 'viz-band'}>
            <rect x={margin.left + band * index} y={margin.top} width={band} height={innerHeight} className="viz-band-bg" />
            {marks}
            {index === data.length - 1 && totals[index] > 0 && (stacked || series.length === 1) && <text x={center} y={baseline - scale(totals[index]) - 6} textAnchor="middle" className="viz-value-text">{format(totals[index])}</text>}
            {index % labelEvery === 0 && <text x={center} y={height - 8} textAnchor="middle" className="viz-axis-text">{monthLabel(row.label, showYear(index))}</text>}
            <rect x={margin.left + band * index} y={margin.top} width={band} height={innerHeight} fill="transparent" tabIndex={0} aria-label={`${fullMonthLabel(row.label)}: ${series.map((item) => `${item.label} ${format(row[item.key] || 0)}`).join(', ')}`} onPointerEnter={() => setActive(index)} onPointerMove={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} />
          </g>
        })}
        <line x1={margin.left} x2={width - margin.right} y1={margin.top + innerHeight} y2={margin.top + innerHeight} className="viz-baseline" />
      </svg>
      {activeRow && <div className="viz-tooltip" style={tooltipStyle} role="status"><strong>{fullMonthLabel(activeRow.label)}</strong>{series.map((item) => <div className="viz-tooltip-row" key={item.key}><span className="viz-key" style={{ background: item.color }} aria-hidden="true" /><b>{format(activeRow[item.key] || 0)}</b><span>{item.label}</span></div>)}{stacked && series.length > 1 && <div className="viz-tooltip-row viz-tooltip-total"><span className="viz-key" aria-hidden="true" /><b>{format(totals[active])}</b><span>Total</span></div>}</div>}
    </div>}
  </ChartCard>
}

// Horizontal bars for ranked categories; the value sits at the bar tip.
export function BarList({ title, description, items, format = (value) => String(value), color = 'var(--viz-s1)', emptyText = 'Nothing to show for this period yet.', maxRows = 8 }) {
  const rows = items.slice(0, maxRows).map((item) => ({ ...item, label: String(item.label).charAt(0).toUpperCase() + String(item.label).slice(1) }))
  const max = Math.max(...rows.map((item) => item.value), 0)
  const table = <DataTable caption={title} columns={['Item', 'Value', 'Detail']} rows={rows.map((item) => [item.label, format(item.value), item.detail || ''])} />
  return <ChartCard title={title} description={description} table={max > 0 ? table : null}>
    {max <= 0 ? <p className="viz-empty">{emptyText}</p> : <ul className="viz-bars">{rows.map((item) => <li key={item.label} title={`${item.label}: ${format(item.value)}${item.detail ? ` (${item.detail})` : ''}`}>
      <span className="viz-bar-label">{item.label}</span>
      <span className="viz-bar-track"><span className="viz-bar-fill" style={{ width: `${Math.max((item.value / max) * 100, item.value > 0 ? 1.5 : 0)}%`, background: color }} /></span>
      <span className="viz-bar-value"><b>{format(item.value)}</b>{item.detail && <small>{item.detail}</small>}</span>
    </li>)}</ul>}
  </ChartCard>
}

// ---------------------------------------------------------------- analytics screens

const SERIES = {
  paid: { key: 'paid', label: 'Paid', color: 'var(--viz-s1)' },
  outstanding: { key: 'outstanding', label: 'Not yet paid', color: 'var(--viz-s2)' },
}

function useAnalytics(request, path) {
  const [months, setMonths] = useState(6)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const load = useCallback(() => {
    setLoading(true)
    request(`${path}?months=${months}`).then((result) => { setData(result); setError('') }).catch((failure) => setError(failure.message)).finally(() => setLoading(false))
  }, [request, path, months])
  useEffect(() => { load() }, [load])
  return { months, setMonths, data, error, loading, load }
}

function ScreenFrame({ months, setMonths, data, error, loading, load, children }) {
  return <div className={loading && data ? 'viz-root is-refreshing' : 'viz-root'}>
    <RangeFilter value={months} onChange={setMonths} />
    {error && <div className="dashboard-error" role="alert"><p>{error}</p><button className="small-button" type="button" onClick={load}>Retry</button></div>}
    {!data && loading && <p className="viz-empty" role="status">Loading analytics...</p>}
    {data && !error && children}
  </div>
}

function CustomerAnalytics({ data }) {
  const { kpis, requests } = data
  return <>
    <KpiRow items={[
      { label: 'Paid', value: money(kpis.paid), note: 'Confirmed by both sides' },
      { label: 'Not yet paid', value: money(kpis.outstanding), note: 'Completed jobs awaiting payment' },
      { label: 'Jobs completed', value: kpis.completedJobs, note: kpis.cancelledJobs ? `${kpis.cancelledJobs} cancelled` : 'None cancelled' },
      { label: 'Average job cost', value: kpis.averageJobCost === null ? '-' : money(kpis.averageJobCost) },
      { label: 'Average rating you give', value: kpis.averageRatingGiven === null ? '-' : `${kpis.averageRatingGiven} / 5`, note: `${kpis.reviewsGiven} ${kpis.reviewsGiven === 1 ? 'review' : 'reviews'}` },
      { label: 'Time to first offer', value: minutesLabel(kpis.averageMinutesToFirstOffer), note: kpis.averageOffersPerRequest === null ? undefined : `${kpis.averageOffersPerRequest} offers per request` },
    ]} />
    <ColumnChart title="Spending by month" description="Value of completed jobs, split by whether payment is confirmed." data={data.monthly.map((row) => ({ ...row, label: row.month }))} series={[SERIES.paid, SERIES.outstanding]} stacked format={money} emptyText="No completed jobs in this period yet." />
    <div className="viz-grid-2">
      <BarList title="Jobs by category" description="Completed jobs, with what you spent." items={data.categories.map((row) => ({ label: row.category, value: row.jobs, detail: money(row.spent) }))} emptyText="No completed jobs in this period yet." />
      <BarList title="Your technicians" description={kpis.repeatTechnicians ? `${kpis.repeatTechnicians} hired more than once.` : 'The technicians you hired most.'} items={data.topTechnicians.map((row) => ({ label: row.name, value: row.jobs, detail: `${money(row.spent)}${row.rating ? ` · ${row.rating}/5` : ''}` }))} emptyText="Hire a technician to see them here." />
    </div>
    <BarList title="What happened to your requests" description={`${requests.total} ${requests.total === 1 ? 'request' : 'requests'} posted in this period.`} items={[{ label: 'Hired a technician', value: requests.hired }, { label: 'Still open', value: requests.open }, { label: 'Closed without hiring', value: requests.closedWithoutHire }]} emptyText="Post a request to see how it goes." />
  </>
}

function TechnicianAnalytics({ data }) {
  const { kpis, offers } = data
  return <>
    <KpiRow items={[
      { label: 'Paid', value: money(kpis.paid), note: 'Confirmed by both sides' },
      { label: 'Not yet paid', value: money(kpis.outstanding), note: 'Completed jobs awaiting payment' },
      { label: 'Jobs completed', value: kpis.completedJobs, note: kpis.averageJobValue === null ? undefined : `${money(kpis.averageJobValue)} average` },
      { label: 'Average rating', value: kpis.averageRating === null ? '-' : `${kpis.averageRating} / 5`, note: `${kpis.reviews} ${kpis.reviews === 1 ? 'review' : 'reviews'}` },
      { label: 'Offers accepted', value: percentLabel(kpis.offerWinRate), note: 'Of offers customers decided on' },
      { label: 'Response time', value: minutesLabel(kpis.averageResponseMinutes), note: 'From request posted to your offer' },
      { label: 'Repeat customers', value: kpis.repeatCustomers, note: 'Hired you more than once' },
      { label: 'Cancelled by you', value: percentLabel(kpis.cancelledByYouRate), note: 'Of jobs you were hired for' },
    ]} />
    <ColumnChart title="Earnings by month" description="Value of completed jobs, split by whether payment is confirmed." data={data.monthly.map((row) => ({ ...row, label: row.month }))} series={[SERIES.paid, SERIES.outstanding]} stacked format={money} emptyText="Finish your first job to see earnings here." />
    <ColumnChart title="Jobs completed by month" data={data.monthly.map((row) => ({ label: row.month, jobs: row.jobs }))} series={[{ key: 'jobs', label: 'Jobs completed', color: 'var(--viz-s1)' }]} emptyText="Finish your first job to see it here." />
    <div className="viz-grid-2">
      <BarList title="Your offers" description={`${offers.declined} declined, ${offers.withdrawn} withdrawn, ${offers.waiting} waiting.`} items={[{ label: 'Offers sent', value: offers.sent }, { label: 'Hired', value: offers.hired }, { label: 'Completed', value: offers.completed }]} emptyText="Send an offer to see how it performs." />
      <BarList title="Ratings received" description="Customer ratings on completed jobs." items={data.ratings.map((row) => ({ label: `${row.rating} ${row.rating === 1 ? 'star' : 'stars'}`, value: row.total }))} emptyText="Ratings will show up after customers review your work." />
    </div>
    <BarList title="Work by category" description="Completed jobs, with what you earned." items={data.categories.map((row) => ({ label: row.category, value: row.jobs, detail: money(row.earned) }))} emptyText="Finish your first job to see it here." />
  </>
}

function AdminAnalytics({ data }) {
  const monthly = data.monthly.map((row) => ({ ...row, label: row.month }))
  return <>
    <KpiRow items={[
      { label: 'Jobs completed', value: percentLabel(data.completionRate), note: 'Of jobs started in this period' },
      { label: 'Cancelled or withdrawn', value: percentLabel(data.droppedRate) },
      { label: 'Time to first offer', value: minutesLabel(data.averageMinutesToFirstOffer), note: 'Average across new requests' },
      { label: 'Open reports', value: data.reports.open, note: `${data.reports.total} in this period${data.reports.hoursToResolve === null ? '' : ` · ${data.reports.hoursToResolve} h to resolve`}` },
      { label: 'Applications waiting', value: data.technicianStatus.pending, note: `${data.technicianStatus.approved} approved · ${data.technicianStatus.suspended} suspended` },
    ]} />
    <ColumnChart title="Requests and completed jobs" description="Demand against jobs that were finished." data={monthly} series={[{ key: 'requests', label: 'Requests posted', color: 'var(--viz-s1)' }, { key: 'completed', label: 'Jobs completed', color: 'var(--viz-s2)' }]} />
    <div className="viz-grid-2">
      <ColumnChart title="Paid job value" description="Confirmed payments between customers and technicians." data={monthly.map((row) => ({ label: row.label, paid: row.paid }))} series={[{ key: 'paid', label: 'Paid job value', color: 'var(--viz-s1)' }]} format={money} />
      <ColumnChart title="New members" description="Sign-ups by account type." data={monthly} series={[{ key: 'customers', label: 'Customers', color: 'var(--viz-s1)' }, { key: 'technicians', label: 'Technicians', color: 'var(--viz-s2)' }]} stacked />
    </div>
    <div className="viz-grid-2">
      <BarList title="Requests by category" items={data.categories.map((row) => ({ label: row.category, value: row.requests }))} />
      <BarList title="Open requests with no offers, by category" description="Where more technicians are needed." items={data.requestsWithoutOffers.map((row) => ({ label: row.category, value: row.requests }))} emptyText="Every open request has an offer." />
    </div>
    <BarList title="Open requests with no offers, by area" description="Dhaka areas that need more technicians right now." items={data.requestsWithoutOffersByArea.map((row) => ({ label: row.area, value: row.requests }))} emptyText="Every open request has an offer." />
    <BarList title="Technician accounts" items={[{ label: 'Approved', value: data.technicianStatus.approved }, { label: 'Pending review', value: data.technicianStatus.pending }, { label: 'Suspended', value: data.technicianStatus.suspended }, { label: 'Rejected', value: data.technicianStatus.rejected }]} emptyText="No technician accounts yet." />
  </>
}

export function AnalyticsScreen({ role, request }) {
  const state = useAnalytics(request, role === 'admin' ? '/admin/analytics' : '/analytics/me')
  const body = state.data && (role === 'admin' ? <AdminAnalytics data={state.data} /> : role === 'technician' ? <TechnicianAnalytics data={state.data} /> : <CustomerAnalytics data={state.data} />)
  return <ScreenFrame {...state}>{body}</ScreenFrame>
}

// ---------------------------------------------------------------- history screen

const STATUS_LABELS = { completed: 'Completed', cancelled: 'Cancelled', rejected: 'Offer declined', withdrawn: 'Offer withdrawn' }

export function HistoryScreen({ role, request, renderActions, reloadToken }) {
  const [filters, setFilters] = useState({ q: '', status: 'all', from: '', to: '' })
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [exporting, setExporting] = useState(false)
  const isTechnician = role === 'technician'

  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedQuery(filters.q); setPage(1) }, 300)
    return () => clearTimeout(timer)
  }, [filters.q])

  const buildQuery = useCallback((extra = {}) => {
    const params = new URLSearchParams()
    if (debouncedQuery.trim()) params.set('q', debouncedQuery.trim())
    if (filters.status !== 'all') params.set('status', filters.status)
    if (filters.from) params.set('from', filters.from)
    if (filters.to) params.set('to', filters.to)
    Object.entries(extra).forEach(([key, value]) => params.set(key, value))
    return params.toString()
  }, [debouncedQuery, filters.status, filters.from, filters.to])

  const load = useCallback(() => {
    setLoading(true)
    request(`/history?${buildQuery({ page, limit: 10 })}`).then((result) => { setData(result); setError('') }).catch((failure) => setError(failure.message)).finally(() => setLoading(false))
  }, [request, buildQuery, page])
  useEffect(() => { load() }, [load, reloadToken])

  const update = (patch) => { setFilters((current) => ({ ...current, ...patch })); setPage(1) }
  const clear = () => { setFilters({ q: '', status: 'all', from: '', to: '' }); setDebouncedQuery(''); setPage(1) }
  const filtered = Boolean(filters.q || filters.status !== 'all' || filters.from || filters.to)
  const pages = data ? Math.max(1, Math.ceil(data.pagination.total / data.pagination.limit)) : 1

  const exportCsv = async () => {
    setExporting(true)
    try {
      const csv = await request(`/history/export?${buildQuery()}`)
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'helplagbe-history.csv'
      link.click()
      URL.revokeObjectURL(url)
    } catch (failure) { setError(failure.message) } finally { setExporting(false) }
  }

  const totals = data?.totals
  return <div className={loading && data ? 'viz-root history-screen is-refreshing' : 'viz-root history-screen'}>
    <div className="history-filters">
      <label>Search<input type="search" value={filters.q} onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} placeholder={isTechnician ? 'Job, category or receipt' : 'Job, technician or receipt'} /></label>
      <label>Status<select value={filters.status} onChange={(event) => update({ status: event.target.value })}><option value="all">All</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>{isTechnician && <option value="declined">Offers not taken</option>}</select></label>
      <label>From<input type="date" value={filters.from} max={filters.to || undefined} onChange={(event) => update({ from: event.target.value })} /></label>
      <label>To<input type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => update({ to: event.target.value })} /></label>
      <div className="history-filter-actions">{filtered && <button type="button" className="quiet-button" onClick={clear}>Clear filters</button>}<button type="button" className="quiet-button" onClick={exportCsv} disabled={exporting || !data?.pagination.total}>{exporting ? 'Preparing...' : 'Export CSV'}</button></div>
    </div>
    {error && <div className="dashboard-error" role="alert"><p>{error}</p><button className="small-button" type="button" onClick={load}>Retry</button></div>}
    {totals && <KpiRow items={[
      { label: 'Jobs', value: totals.total, note: `${totals.completed} completed · ${totals.cancelled} cancelled` },
      { label: isTechnician ? 'Earned (paid)' : 'Spent (paid)', value: money(totals.paid) },
      { label: 'Not yet paid', value: money(totals.outstanding) },
    ]} />}
    {!data && loading && <p className="viz-empty" role="status">Loading history...</p>}
    {data && (data.items.length ? <ul className="history-list">{data.items.map((item) => {
      const open = expanded === item.taskId
      const actions = open && renderActions ? renderActions(item) : null
      return <li className="history-item" key={item.taskId} data-task-id={item.taskId}>
        <div className="history-row">
          <div className="history-main"><span className="request-category">{item.category}{item.area ? ` · ${item.area}` : ''}</span><h3>{item.detail}</h3><span className="muted-label">{item.date ? new Date(item.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : ''}{item.counterpart ? ` · ${isTechnician ? 'Customer' : 'Technician'}: ${item.counterpart}` : ''}</span></div>
          <div className="history-meta"><span className={`dashboard-status status-${item.status}`}>{STATUS_LABELS[item.status] || item.status}</span><strong>{money(item.value)}</strong>{item.status === 'completed' && <span className="muted-label">{item.paymentStatus === 'paid' ? `Paid${item.paymentMethod ? ` · ${item.paymentMethod.replace('_', ' ')}` : ''}` : 'Payment pending'}</span>}{item.rating !== null && <span className="muted-label">{'★'} {item.rating}/5</span>}</div>
          <button type="button" className="quiet-button history-toggle" aria-expanded={open} onClick={() => setExpanded(open ? null : item.taskId)}>{open ? 'Hide details' : 'Details'}</button>
        </div>
        {open && <div className="history-details">
          <dl>{item.receiptNumber && <><dt>Receipt</dt><dd>{item.receiptNumber}</dd></>}{item.cancelReason && <><dt>Cancellation reason</dt><dd>{item.cancelReason}</dd></>}<dt>Job reference</dt><dd>#{item.taskId}</dd></dl>
          {actions}
        </div>}
      </li>
    })}</ul> : <p className="viz-empty">{filtered ? 'No jobs match these filters.' : isTechnician ? 'Finished jobs and offers that were not taken will appear here.' : 'Completed and cancelled jobs will appear here.'}</p>)}
    {data && data.pagination.total > data.pagination.limit && <nav className="history-pager" aria-label="History pages"><button type="button" className="quiet-button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</button><span>Page {page} of {pages}</span><button type="button" className="quiet-button" disabled={page >= pages} onClick={() => setPage((current) => current + 1)}>Next</button></nav>}
  </div>
}
