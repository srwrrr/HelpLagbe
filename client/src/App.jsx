import { useCallback, useEffect, useState } from 'react'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api'
const SERVER_URL = API_URL.replace(/\/api$/, '')
const REVIEW_COMPLIMENTS = [
  'On time',
  'Great communication',
  'Professional',
  'Quality work',
  'Fair price',
  'Clean and careful',
  'Friendly and respectful',
  'Went above and beyond',
]

function parseReviewData(value) {
  if (!value) return { review: '', compliments: [] }
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        review: typeof parsed.review === 'string' ? parsed.review : '',
        compliments: Array.isArray(parsed.compliments) ? parsed.compliments.filter((item) => REVIEW_COMPLIMENTS.includes(item)) : [],
      }
    }
  } catch {}
  return { review: value, compliments: [] }
}

function getAssetUrl(path) {
  return path ? `${SERVER_URL}/${path.replace(/^\//, '')}` : ''
}

function ProfileAvatar({ name, image, className = 'profile-avatar' }) {
  return <span className={className}>{image ? <img src={getAssetUrl(image)} alt="" /> : (name?.slice(0, 1) || '?')}</span>
}

function toDateTimeInputValue(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

function dateTimeToIso(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('helplagbe_user') || 'null')
  } catch {
    return null
  }
}

function normalizePath() {
  const hashPath = window.location.hash.startsWith('#/') ? window.location.hash.slice(1) : ''
  return hashPath || window.location.pathname || '/'
}

function getRouteQueryValue(key) {
  const hashQuery = window.location.hash.includes('?') ? window.location.hash.split('?').slice(1).join('?') : ''
  return new URLSearchParams(hashQuery || window.location.search).get(key)
}

function go(path) {
  const nextPath = path === '/' ? '/' : path.startsWith('/') ? path : `/${path}`
  const target = nextPath === '/' ? '/' : `/#${nextPath}`
  window.history.pushState({}, '', target)
  window.dispatchEvent(new PopStateEvent('popstate'))
  window.scrollTo(0, 0)
}

function usePath() {
  const [path, setPath] = useState(normalizePath)
  useEffect(() => {
    const updatePath = () => setPath(normalizePath())
    window.addEventListener('popstate', updatePath)
    window.addEventListener('hashchange', updatePath)
    return () => {
      window.removeEventListener('popstate', updatePath)
      window.removeEventListener('hashchange', updatePath)
    }
  }, [])
  return path
}

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(localStorage.getItem('helplagbe_token') ? { Authorization: `Bearer ${localStorage.getItem('helplagbe_token')}` } : {}),
      ...options.headers,
    },
  })

  const contentType = response.headers.get('content-type') || ''
  const data = contentType.includes('application/json') ? await response.json() : await response.text()

  if (!response.ok) {
    const message = typeof data === 'string' ? data : data?.message || 'Something went wrong.'
    throw new Error(message)
  }

  return data
}

function Brand() {
  return <button className="brand" type="button" onClick={() => go('/')}><span className="brand-mark">H</span><span>HelpLagbe</span></button>
}

function ThemeToggle() {
  const [theme, setTheme] = useState(() => localStorage.getItem('helplagbe_theme') || 'dark')
  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(nextTheme)
    localStorage.setItem('helplagbe_theme', nextTheme)
    document.documentElement.dataset.theme = nextTheme
  }

  return <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}><span aria-hidden="true">{theme === 'dark' ? '☼' : '☾'}</span><span>{theme === 'dark' ? 'Light' : 'Dark'}</span></button>
}

function NotificationCenter({ user }) {
  const [notifications, setNotifications] = useState([])
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    if (!user) return
    const load = () => request('/notifications').then(setNotifications).catch((error) => setMessage(error.message))
    load()
    const timer = window.setInterval(load, 30000)
    return () => window.clearInterval(timer)
  }, [user])
  const unread = notifications.filter((notification) => !notification.readAt).length
  const markRead = async (notification) => {
    if (notification.readAt) return true
    try {
      await request(`/notifications/${notification.id}/read`, { method: 'PATCH' })
      setNotifications((items) => items.map((item) => item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item))
      return true
    } catch (error) {
      setMessage(error.message)
      return false
    }
  }
  const openNotification = async (notification) => {
    setMessage('')
    if (!await markRead(notification)) return
    setOpen(false)
    if (notification.targetType !== 'task' || !notification.targetId || !['customer', 'technician'].includes(user.role)) return
    const section = notification.type === 'message'
      ? 'dashboard-messages'
      : user.role === 'customer'
        ? 'customer-requests'
        : ['task_completed', 'task_cancelled', 'payment_confirmation', 'bid_withdrawn', 'request_closed', 'bid_rejected'].includes(notification.type)
          ? 'technician-history'
          : notification.type === 'request_updated'
            ? 'technician-offers'
            : 'technician-active'
    go(`/${user.role}?section=${section}&taskId=${encodeURIComponent(notification.targetId)}`)
  }
  if (!user) return null
  return <div className="notification-center"><button className="notification-button" type="button" onClick={() => setOpen(!open)} aria-label="Notifications" aria-expanded={open} title="Notifications"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></svg>{unread > 0 && <b>{unread > 9 ? '9+' : unread}</b>}</button>{open && <div className="notification-menu"><div className="notification-menu-heading"><strong>Notifications</strong><span>{unread ? `${unread} unread` : 'All caught up'}</span></div>{message && <p className="form-message" role="alert">{message}</p>}{notifications.length ? notifications.map((notification) => <button className={`notification-item ${notification.readAt ? 'is-read' : ''}`} type="button" key={notification.id} onClick={() => openNotification(notification)}><strong>{notification.title}</strong><span>{notification.message}</span><small>{new Date(notification.createdAt).toLocaleString()}{notification.targetType === 'task' ? ' · View task' : ''}</small></button>) : <p className="notification-empty">No notifications yet.</p>}</div>}</div>
}

function Header({ user }) {
  const logout = () => {
    localStorage.removeItem('helplagbe_token')
    localStorage.removeItem('helplagbe_user')
    window.dispatchEvent(new Event('helplagbe-auth'))
    go('/')
  }
  return <header className="site-header"><Brand /><nav className="site-nav" aria-label="Primary navigation"><button type="button" onClick={() => go('/')}>Home</button><button type="button" onClick={() => go('/requests')}>Browse requests</button><button type="button" onClick={() => go('/technicians')}>Find technicians</button><ThemeToggle />{user ? <><NotificationCenter user={user} /><button type="button" className="nav-dashboard" onClick={() => go(`/${user.role}`)}>Dashboard</button><button type="button" className="nav-login" onClick={logout}>Log out</button></> : <button type="button" className="nav-login" onClick={() => go('/login')}>Log in</button>}</nav></header>
}

function Footer() {
  return <footer className="site-footer page-width">
    <div className="footer-brand"><Brand /><span>Help anytime, anywhere.</span></div>
    <div className="footer-contact">
      <strong>Get in touch</strong>
      <a href="mailto:sarwarhossain083@gmail.com">sarwarhossain083@gmail.com</a>
      <a href="tel:+8801325490985">01325409985</a>
    </div>
  </footer>
}

function Shell({ children, user }) {
  return <main className="app-shell"><Header user={user} />{children}<Footer /></main>
}

function Home({ posts, postsLoading, postsError, user }) {
  const startRequest = () => go(user?.role === 'customer' ? '/customer/new-request' : '/register')
  return <Shell user={user}>
    <section className="hero-section page-width">
      <div className="hero-copy">
        <p className="eyebrow">A little help goes a long way</p>
        <h1>What needs fixing at home?</h1>
        <p className="hero-text">From a leaky tap to an appliance on the fritz, find help for the jobs that make home feel like home.</p>
        <div className="hero-actions">
          <button className="primary-button" type="button" onClick={startRequest}>Post a service request</button>
          <button className="outline-button" type="button" onClick={() => go('/technicians')}>Browse technicians</button>
        </div>
        <p className="hero-reassurance">Browse admin-approved technicians and compare offers before you choose.</p>
        <p className="hero-technician-link">Are you a skilled professional? <button type="button" onClick={() => go('/register-technician')}>Join as a technician <span aria-hidden="true">-&gt;</span></button></p>
      </div>
      <div className="hero-visual">
        <img src="/home-service.jpg" alt="A service professional repairing a home appliance" />
        <div className="hero-photo-caption"><span>HelpLagbe</span><strong>Good help makes home feel easier.</strong></div>
      </div>
    </section>
    <section className="services-section page-width">
      <div className="section-heading">
        <div><p className="eyebrow">Here for the everyday fixes</p><h2>How can we help?</h2></div>
        <button className="outline-button" type="button" onClick={startRequest}>Tell us what you need</button>
      </div>
      <div className="service-grid">
        <ServiceCard tone="warm" icon="AC" title="Appliance repair" text="AC, washing machines, refrigerators, and more." />
        <ServiceCard tone="green" icon="PL" title="Plumbing" text="Leaks, fixtures, pipes, and urgent repairs." />
        <ServiceCard tone="blue" icon="EL" title="Electrical work" text="Safe installation and everyday electrical fixes." />
        <ServiceCard tone="lilac" icon="HM" title="Home maintenance" text="Small jobs that make a big difference." />
      </div>
    </section>
    <section className="steps-section page-width"><div className="section-heading"><div><p className="eyebrow">How HelpLagbe works</p><h2>From “I need help” to “all sorted.”</h2></div></div><div className="steps-grid"><Step number="01" title="Describe the job" text="Tell us what needs fixing and add a photo if it helps." /><Step number="02" title="Compare local bids" text="Technicians respond with their price and availability." /><Step number="03" title="Choose your helper" text="Accept the bid that feels right and track the task." /></div></section>
    <RequestPreview posts={posts} loading={postsLoading} error={postsError} />
  </Shell>
}

function ServiceCard({ tone, icon, title, text }) { return <article className={`service-card ${tone}`}><span className="service-icon">{icon}</span><h3>{title}</h3><p>{text}</p><span className="service-arrow">-&gt;</span></article> }
function Step({ number, title, text }) { return <div className="step"><span className="step-number">{number}</span><h3>{title}</h3><p>{text}</p></div> }

function RequestPreview({ posts, loading, error }) {
  return <section className="request-section page-width"><div className="section-heading"><div><p className="eyebrow">Live service requests</p><h2>See what people need today.</h2></div><button className="outline-button" type="button" onClick={() => go('/requests')}>Browse marketplace</button></div>{loading ? <LoadingState text="Loading service requests..." /> : error ? <p className="form-message" role="alert">{error}</p> : posts.length ? <div className="request-grid">{posts.slice(0, 6).map((post) => <RequestCard key={post.id} post={post} />)}</div> : <EmptyState text="No live requests yet." />}</section>
}

function RequestCard({ post, action }) {
  return <article className="request-card">{post.image && <img className="request-image" src={getAssetUrl(post.image)} alt="Attached request" />}<span className="request-category">{post.category}</span><h3>{post.detail}</h3><p>{post.customerName || 'Anonymous customer'} · Posted {post.createdAt ? new Date(post.createdAt).toLocaleDateString() : 'recently'}</p>{action}</article>
}
function EmptyState({ text }) { return <div className="empty-state"><span className="empty-icon">-</span><p>{text}</p></div> }
function LoadingState({ text = 'Loading...' }) { return <div className="loading-state" role="status"><span className="loading-spinner" aria-hidden="true"></span><p>{text}</p></div> }

function ReviewPanel({ active }) {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = async () => {
    try {
      setPosts(await request('/customer/posts'))
      setError('')
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    if (!active) return undefined
    let mounted = true
    request('/customer/posts')
      .then((items) => { if (mounted) { setPosts(items); setError('') } })
      .catch((loadError) => { if (mounted) setError(loadError.message) })
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [active])
  const completedTasks = posts.filter((post) => post.taskId && post.status === 'completed')

  return <section className="panel review-panel">
    <div className="panel-heading"><div><p className="eyebrow">Completed work</p><h2>Recognize a great job</h2><p className="muted-label">Rate each completed task and share what stood out.</p></div><span className="verified-label">{completedTasks.length} ready</span></div>
    {loading ? <LoadingState text="Loading completed tasks..." /> : error ? <div className="dashboard-error" role="alert"><p>{error}</p><button className="small-button" type="button" onClick={load}>Retry</button></div> : completedTasks.length ? <div className="completed-review-list">{completedTasks.map((task) => <TaskReviewForm key={task.taskId} task={task} onSaved={load} />)}</div> : <EmptyState text="A review form will appear here when one of your jobs is completed." />}
  </section>
}

function TaskReviewForm({ task, onSaved }) {
  const initialReview = parseReviewData(task.reviewText)
  const [rating, setRating] = useState(Number(task.reviewRating) || 0)
  const [hoveredRating, setHoveredRating] = useState(0)
  const [compliments, setCompliments] = useState(initialReview.compliments)
  const [review, setReview] = useState(initialReview.review)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const ratingLabels = ['Needs work', 'Could be better', 'Good', 'Great', 'Excellent']

  const submit = async (event) => {
    event.preventDefault()
    if (!rating) {
      setMessage('Choose a star rating before submitting.')
      return
    }
    setSaving(true)
    setMessage('')
    try {
      await request(`/tasks/${task.taskId}/review`, { method: 'POST', body: JSON.stringify({ rating, review, compliments }) })
      setMessage('Thanks for recognizing great work.')
      await onSaved()
    } catch (saveError) {
      setMessage(saveError.message)
    } finally {
      setSaving(false)
    }
  }

  const toggleCompliment = (compliment) => {
    setCompliments((selected) => selected.includes(compliment)
      ? selected.filter((item) => item !== compliment)
      : selected.length < 5 ? [...selected, compliment] : selected)
  }
  const previewRating = hoveredRating || rating

  return <article className="task-review-card">
    <div className="task-review-context"><div><span className="request-category">{task.category}</span><h3>{task.detail}</h3><span className="muted-label">Technician: {task.technicianName || 'Approved technician'}</span></div><span className="dashboard-status status-completed">Completed</span></div>
    <form className="interactive-review-form" onSubmit={submit}>
      <fieldset className="star-rating-field">
        <legend>Your rating <span>{previewRating ? ratingLabels[previewRating - 1] : 'Tap a star to start'}</span></legend>
        <div className="star-rating" onMouseLeave={() => setHoveredRating(0)}>
          {[1, 2, 3, 4, 5].map((value) => <button key={value} className={value <= previewRating ? 'rating-star is-active' : 'rating-star'} type="button" aria-label={`Rate ${value} out of 5`} aria-pressed={rating === value} onMouseEnter={() => setHoveredRating(value)} onFocus={() => setHoveredRating(value)} onBlur={() => setHoveredRating(0)} onClick={() => setRating(value)}>{value <= previewRating ? '★' : '☆'}</button>)}
        </div>
      </fieldset>
      <fieldset className="compliment-field">
        <legend>What did they do especially well? <span>Choose up to 5</span></legend>
        <div className="compliment-options">{REVIEW_COMPLIMENTS.map((compliment) => <button key={compliment} className={compliments.includes(compliment) ? 'compliment-chip is-selected' : 'compliment-chip'} type="button" aria-pressed={compliments.includes(compliment)} onClick={() => toggleCompliment(compliment)}>{compliments.includes(compliment) ? '✓ ' : '+ '}{compliment}</button>)}</div>
      </fieldset>
      <label className="review-comment">Add a note <span>Optional</span><textarea rows="3" maxLength="500" value={review} onChange={(event) => setReview(event.target.value)} placeholder="What should other customers know?" /></label>
      <div className="review-submit-row"><span className="muted-label">Your feedback helps customers choose with confidence.</span><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving...' : task.reviewRating ? 'Update review' : 'Submit review'}</button></div>
      {message && <p className="form-message" role="status">{message}</p>}
    </form>
  </article>
}

function AcceptedTechnicianProfile({ technician }) {
  const [expanded, setExpanded] = useState(false)
  const completedJobs = Number(technician.technicianCompletedJobs) || 0
  const reviewCount = Number(technician.technicianReviewCount) || 0
  const averageRating = Number(technician.technicianAverageRating) || 0

  return <section className="accepted-technician-profile">
    <button className="technician-profile-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
      <ProfileAvatar name={technician.technicianName || 'Technician'} image={technician.technicianProfileImage} />
      <span className="technician-profile-intro"><strong>{technician.technicianName || 'Approved technician'}</strong><small>{technician.technicianSkills || 'Technician application approved'}</small></span>
      <span className="technician-profile-action">{expanded ? 'Hide profile' : 'View profile'} <span aria-hidden="true">{expanded ? '−' : '+'}</span></span>
    </button>
    {expanded && <div className="technician-profile-details">
      <div className="technician-profile-identity"><ProfileAvatar name={technician.technicianName || 'Technician'} image={technician.technicianProfileImage} /><div><span className="eyebrow">Application approved</span><h3>{technician.technicianName || 'Technician profile'}</h3><p>{technician.technicianSkills || 'Skilled home-service professional'}</p>{technician.technicianPhone && <a className="technician-contact-link" href={`tel:${technician.technicianPhone}`}>Call technician: {technician.technicianPhone}</a>}</div></div>
      <div className="technician-profile-stats">
        <div><strong>{completedJobs}</strong><span>Tasks completed</span></div>
        <div><strong>{averageRating ? `${averageRating.toFixed(1)} / 5` : 'New'}</strong><span>{reviewCount ? `Overall rating · ${reviewCount} ${reviewCount === 1 ? 'review' : 'reviews'}` : 'No ratings yet'}</span></div>
      </div>
    </div>}
  </section>
}

function PendingTechnicianOverview({ taskId }) {
  const [open, setOpen] = useState(false)
  const [overview, setOverview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const toggle = async () => {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    if (overview || loading) return
    setLoading(true)
    setError('')
    try {
      setOverview(await request(`/customer/bids/${taskId}/technician`))
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  const reviews = (overview?.reviews || []).map((item) => {
    try {
      const parsed = JSON.parse(item.feedback || '')
      return {
        rating: item.rating,
        text: typeof parsed?.review === 'string' ? parsed.review : '',
        compliments: Array.isArray(parsed?.compliments) ? parsed.compliments : [],
      }
    } catch {
      return { rating: item.rating, text: item.feedback || '', compliments: [] }
    }
  })

  return <section className="pending-technician-overview">
    <button className="technician-profile-toggle" type="button" aria-expanded={open} onClick={toggle}>
      <span className="technician-profile-action">{open ? 'Hide technician overview' : 'Review technician before accepting'} <span aria-hidden="true">{open ? '−' : '+'}</span></span>
    </button>
    {open && <div className="technician-overview-details">
      {loading && <p className="muted-label">Loading technician overview...</p>}
      {error && <p className="form-message" role="alert">{error}</p>}
      {overview && <>
        <div className="technician-profile-identity">
          <ProfileAvatar name={overview.name} image={overview.profileImage} />
          <div><span className="eyebrow">Technician overview</span><h3>{overview.name}</h3><p>{overview.skills}</p></div>
        </div>
        <div className="technician-profile-stats">
          <div><strong>{Number(overview.completedJobs) || 0}</strong><span>Tasks completed</span></div>
          <div><strong>{overview.averageRating ? `${Number(overview.averageRating).toFixed(1)} / 5` : 'New'}</strong><span>{overview.reviewCount ? `Overall rating · ${overview.reviewCount} ${Number(overview.reviewCount) === 1 ? 'review' : 'reviews'}` : 'No ratings yet'}</span></div>
        </div>
        {(overview.serviceArea || overview.availability) && <p className="muted-label">{[overview.serviceArea, overview.availability].filter(Boolean).join(' · ')}</p>}
        <div className="technician-overview-columns">
          <div><h4>Recent completed work</h4>{overview.workHistory.length ? <ul>{overview.workHistory.map((job, index) => <li key={`${job.category}-${index}`}><strong>{job.category}</strong><p>{job.detail}</p></li>)}</ul> : <p className="muted-label">No completed work on HelpLagbe yet.</p>}</div>
          <div><h4>Recent customer reviews</h4>{reviews.length ? <ul>{reviews.map((review, index) => <li key={`${review.rating}-${index}`}><strong>{'★'.repeat(Number(review.rating))} <span className="muted-label">{review.rating}/5</span></strong>{review.text && <p>{review.text}</p>}{review.compliments.length > 0 && <span className="muted-label">{review.compliments.join(' · ')}</span>}</li>)}</ul> : <p className="muted-label">No customer reviews yet.</p>}</div>
        </div>
      </>}
    </div>}
  </section>
}

function TaskServiceLocation({ task }) {
  if (!task.serviceAddress && !task.customerPhone) return null
  const address = [task.serviceAddress, task.building, task.flatNo ? `Flat ${task.flatNo}` : ''].filter(Boolean).join(', ')
  return <div className="task-service-location">
    <strong>Customer visit details</strong>
    {address && <span>{address}</span>}
    {task.customerPhone && <a href={`tel:${task.customerPhone}`}>Customer phone: {task.customerPhone}</a>}
    {!task.customerPhone && <span className="muted-label">Customer has not added a phone number.</span>}
  </div>
}

function CustomerRequestControls({ post, bids, onUpdated }) {
  const [editing, setEditing] = useState(!post.serviceAddress && !post.closedAt)
  const [closing, setClosing] = useState(false)
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    detail: post.detail || '',
    category: post.category || 'Appliance',
    subCategory: post.subCategory || '',
    serviceAddress: post.serviceAddress || '',
    building: post.building || '',
    flatNo: post.flatNo || '',
  })
  const hasAcceptedTechnician = bids.some((bid) => ['accepted', 'scheduled', 'in_progress', 'completed'].includes(bid.status))
  const canEdit = !post.closedAt && !hasAcceptedTechnician

  const update = async (event) => {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    try {
      const result = await request(`/customer/posts/${post.id}`, { method: 'PATCH', body: JSON.stringify(form) })
      setMessage(result.message)
      setEditing(false)
      await onUpdated()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setSaving(false)
    }
  }

  const closeRequest = async () => {
    if (reason.trim().length < 5) {
      setMessage('Please provide a reason of at least 5 characters.')
      return
    }
    if (!window.confirm('Close this request? Pending offers will be declined and technicians will be notified. This cannot be reopened.')) return
    setSaving(true)
    setMessage('')
    try {
      const result = await request(`/customer/posts/${post.id}/close`, { method: 'POST', body: JSON.stringify({ reason }) })
      setMessage(result.message)
      setClosing(false)
      setReason('')
      await onUpdated()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setSaving(false)
    }
  }

  if (!canEdit) return post.closedAt
    ? <div className="request-management-note"><strong>Request closed</strong>{post.closeReason && <span>Reason: {post.closeReason}</span>}</div>
    : null

  return <section className="request-management">
    <div className="request-management-actions">
      <button className="quiet-button" type="button" onClick={() => { setEditing((open) => !open); setClosing(false) }}>{editing ? 'Hide edit form' : post.serviceAddress ? 'Edit request' : 'Add service address'}</button>
      <button className="quiet-button danger-button" type="button" onClick={() => { setClosing((open) => !open); setEditing(false) }}>{closing ? 'Keep request open' : 'Close request'}</button>
    </div>
    {editing && <form className="request-form request-edit-form" onSubmit={update}>
      <label>Job description<textarea rows="3" maxLength="2000" minLength="10" value={form.detail} onChange={(event) => setForm({ ...form, detail: event.target.value })} required /><span className="muted-label">Keep out phone numbers, email addresses, and your exact location. Use the private address fields below.</span></label>
      <div className="form-row"><label>Category<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option>Appliance</option><option>Plumbing</option><option>Electrical</option><option>Home maintenance</option><option>Computer</option></select></label><label>Subcategory<input maxLength="100" value={form.subCategory} onChange={(event) => setForm({ ...form, subCategory: event.target.value })} /></label></div>
      <fieldset className="request-location-fields"><legend>Private service location</legend><label>Service address<input autoComplete="street-address" maxLength="500" value={form.serviceAddress} onChange={(event) => setForm({ ...form, serviceAddress: event.target.value })} required /></label><div className="form-row"><label>Building / house name<input maxLength="150" value={form.building} onChange={(event) => setForm({ ...form, building: event.target.value })} /></label><label>Flat / unit number<input maxLength="100" value={form.flatNo} onChange={(event) => setForm({ ...form, flatNo: event.target.value })} /></label></div></fieldset>
      <button className="small-button" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save request changes'}</button>
    </form>}
    {closing && <div className="request-close-form"><label>Why are you closing this request?<input maxLength="500" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. No longer need this repair" /></label><button className="quiet-button danger-button" type="button" disabled={saving || reason.trim().length < 5} onClick={closeRequest}>{saving ? 'Closing...' : 'Confirm close request'}</button></div>}
    {message && <p className="form-message" role="status">{message}</p>}
  </section>
}

function ReportForm({ reportType, taskId, messageId, technicianId }) {
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState(reportType === 'dispute' ? 'Payment or price dispute' : 'Inappropriate conduct')
  const [description, setDescription] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    try {
      await request('/reports', {
        method: 'POST',
        body: JSON.stringify({ reportType, taskId, messageId, technicianId, category, description }),
      })
      setMessage('Sent to the HelpLagbe safety team.')
      setDescription('')
      setOpen(false)
    } catch (error) {
      setMessage(error.message)
    } finally {
      setSaving(false)
    }
  }
  return <div className="report-form-wrap">
    <button className="quiet-button danger-button" type="button" onClick={() => setOpen((value) => !value)}>{open ? 'Close report form' : reportType === 'profile' ? 'Report profile' : reportType === 'message' ? 'Report message' : 'Report a problem'}</button>
    {open && <form className="request-form inline-report-form" onSubmit={submit}>
      <label>Issue<select value={category} onChange={(event) => setCategory(event.target.value)}><option>Inappropriate conduct</option><option>Safety concern</option><option>Payment or price dispute</option><option>Service not delivered</option><option>Misleading profile or message</option><option>Other</option></select></label>
      <label>What happened?<textarea rows="3" maxLength="1000" minLength="10" value={description} onChange={(event) => setDescription(event.target.value)} required placeholder="Describe the issue. Please do not include passwords or payment-card details." /></label>
      <button className="small-button" type="submit" disabled={saving}>{saving ? 'Sending...' : 'Submit report'}</button>
    </form>}
    {message && <p className="form-message" role="status">{message}</p>}
  </div>
}

function TaskLifecyclePanel({ task, userRole, onUpdated }) {
  const taskId = task.taskId || task.id
  const [timeline, setTimeline] = useState([])
  const [scheduleDraft, setScheduleDraft] = useState(() => ({ source: task.proposedAt, value: toDateTimeInputValue(task.proposedAt) }))
  const proposedAt = scheduleDraft.source === task.proposedAt ? scheduleDraft.value : toDateTimeInputValue(task.proposedAt)
  const [reason, setReason] = useState('')
  const [priceDraft, setPriceDraft] = useState('')
  const [priceChangeReason, setPriceChangeReason] = useState('')
  const [paymentMethod, setPaymentMethod] = useState(task.paymentMethod || 'cash')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const loadTimeline = useCallback(() => request(`/tasks/${taskId}/timeline`).then(setTimeline).catch((error) => setMessage(error.message)), [taskId])
  useEffect(() => { loadTimeline() }, [loadTimeline])
  const saveAction = async (path, body, success) => {
    setSaving(true)
    setMessage('')
    try {
      const result = await request(path, { method: 'POST', body: JSON.stringify(body) })
      setMessage(result.message || success)
      setReason('')
      if (body.proposedAt) setScheduleDraft({ source: body.proposedAt, value: toDateTimeInputValue(body.proposedAt) })
      await onUpdated()
      await loadTimeline()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setSaving(false)
    }
  }
  const currentStep = ({ pending: 0, accepted: 1, scheduled: 2, in_progress: 3, completed: 4 })[task.status] ?? -1
  const ownScheduleConfirmation = userRole === 'customer' ? task.customerScheduleConfirmedAt : task.technicianScheduleConfirmedAt
  const canConfirmSchedule = task.status === 'accepted' && task.proposedAt && !ownScheduleConfirmation
  const ownPaymentConfirmation = userRole === 'customer' ? task.customerPaidConfirmedAt : task.technicianPaidConfirmedAt
  const canChangeSchedule = ['accepted', 'scheduled'].includes(task.status)
  const canProposePriceChange = ['accepted', 'scheduled', 'in_progress'].includes(task.status) && task.priceChangeProposed == null
  const priceChangePendingForCurrentUser = task.priceChangeProposed != null && Number(task.priceChangeProposedBy) !== Number(getStoredUser()?.id)
  const savePriceChange = async (path, body, success) => {
    setSaving(true)
    setMessage('')
    try {
      const result = await request(path, { method: 'POST', body: JSON.stringify(body) })
      setMessage(result.message || success)
      setPriceChangeReason('')
      setPriceDraft('')
      await onUpdated()
      await loadTimeline()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setSaving(false)
    }
  }

  return <section className="task-lifecycle-panel" aria-label="Booking status and actions">
    <div className="booking-timeline" aria-label="Booking progress">
      {['Offer received', 'Accepted', 'Scheduled', 'In progress', 'Completed'].map((step, index) => <div className={`booking-step ${currentStep >= index ? 'is-complete' : ''} ${currentStep === index ? 'is-current' : ''}`} key={step}><span>{currentStep > index ? '✓' : index + 1}</span><small>{step}</small></div>)}
      {['cancelled', 'rejected', 'withdrawn'].includes(task.status) && <span className={`dashboard-status status-${task.status}`}>{task.status === 'cancelled' ? `Cancelled: ${task.cancelReason || 'Reason recorded'}` : task.status === 'withdrawn' ? `Offer withdrawn: ${task.cancelReason || 'Reason recorded'}` : 'Offer declined'}</span>}
    </div>
    {task.proposedAt && <p className="muted-label">Proposed appointment: <strong>{new Date(task.proposedAt).toLocaleString()}</strong></p>}
    {userRole === 'customer' && ['accepted', 'scheduled', 'in_progress', 'completed'].includes(task.status) && <p className="muted-label">Current agreed price: <strong>৳{task.agreedPrice ?? task.price}</strong></p>}
    {task.priceDetails && <p className="offer-price-details"><strong>Offer includes:</strong> {task.priceDetails}</p>}
    {!!timeline.length && <details className="task-event-history"><summary>Timeline details</summary><ol>{timeline.map((item) => <li key={item.id}><strong>{item.type.replaceAll('_', ' ')}</strong><span>{new Date(item.createdAt).toLocaleString()}{item.actorName ? ` · ${item.actorName}` : ''}</span>{item.scheduledFor && <span>Appointment: {new Date(item.scheduledFor).toLocaleString()}</span>}{item.reason && <p>{item.reason}</p>}</li>)}</ol></details>}
    {task.priceChangeProposed != null && <div className="price-change-proposal"><strong>Proposed agreed price: ৳{task.priceChangeProposed}</strong><p>{task.priceChangeReason}</p>{priceChangePendingForCurrentUser ? <div className="task-lifecycle-actions"><button className="small-button" type="button" disabled={saving} onClick={() => savePriceChange(`/tasks/${taskId}/price-change/decision`, { accept: true }, 'Price change accepted.')}>Accept new price</button><button className="quiet-button danger-button" type="button" disabled={saving} onClick={() => savePriceChange(`/tasks/${taskId}/price-change/decision`, { accept: false }, 'Price change declined.')}>Decline</button></div> : <span className="muted-label">Waiting for the other participant to decide.</span>}</div>}
    {canProposePriceChange && <div className="price-change-form"><strong>Change agreed price</strong><p className="muted-label">The other participant must approve a price change before it takes effect.</p><div className="task-lifecycle-actions"><label>New price<input type="number" min="0.01" step="0.01" value={priceDraft} onChange={(event) => setPriceDraft(event.target.value)} placeholder={String(task.agreedPrice ?? task.price)} /></label><label>Why is the price changing?<input maxLength="450" value={priceChangeReason} onChange={(event) => setPriceChangeReason(event.target.value)} placeholder="Explain any added work, parts, or costs" /></label><button className="quiet-button" type="button" disabled={saving || !Number(priceDraft) || priceChangeReason.trim().length < 5} onClick={() => savePriceChange(`/tasks/${taskId}/price-change`, { proposedPrice: Number(priceDraft), reason: priceChangeReason }, 'Price change proposed.')}>Propose price change</button></div></div>}
    {canChangeSchedule && <div className="task-lifecycle-actions">
      <label>New appointment time<input type="datetime-local" value={proposedAt} onChange={(event) => setScheduleDraft({ source: task.proposedAt, value: event.target.value })} /></label>
      <label>Reason for change or cancellation<input maxLength="500" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why this needs to change" /></label>
      <button className="quiet-button" type="button" disabled={saving || !proposedAt || reason.trim().length < 5} onClick={() => saveAction(`/tasks/${taskId}/schedule`, { proposedAt: dateTimeToIso(proposedAt), reason }, 'Appointment change proposed.')}>Propose new time</button>
    </div>}
    {canConfirmSchedule && <button className="small-button" type="button" disabled={saving} onClick={() => saveAction(`/tasks/${taskId}/schedule/confirm`, {}, 'Appointment confirmation saved.')}>Confirm appointment</button>}
    {task.status === 'completed' && <div className="payment-record">
      <strong>Agreed price: ৳{task.agreedPrice ?? task.price}</strong>
      {task.paymentStatus === 'paid' ? <div className="receipt-record"><span>Paid · {task.paymentMethod?.replace('_', ' ')}</span><span>Receipt {task.receiptNumber}</span>{task.paidAt && <span>{new Date(task.paidAt).toLocaleString()}</span>}</div> : <>
        <p className="muted-label">Payment is recorded only after both people confirm. HelpLagbe does not process or hold the money.</p>
        <div className="task-lifecycle-actions"><label>Payment method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="other">Other / agreed method</option></select></label>
          <button className="small-button" type="button" disabled={saving || Boolean(ownPaymentConfirmation)} onClick={() => saveAction(`/tasks/${taskId}/payment/confirm`, { paymentMethod }, 'Payment confirmation saved.')}>{ownPaymentConfirmation ? 'Waiting for other confirmation' : 'Confirm payment'}</button>
        </div>
      </>}
    </div>}
    {['accepted', 'scheduled', 'in_progress'].includes(task.status) && <div className="task-cancel-actions">
      <label>Cancellation reason<input maxLength="500" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Required if cancelling this task" /></label>
      <button className="quiet-button danger-button" type="button" disabled={saving || reason.trim().length < 5} onClick={() => saveAction(`/tasks/${taskId}/cancel`, { reason }, 'Task cancelled.')}>Cancel task</button>
    </div>}
    {taskId && userRole && <ReportForm reportType="dispute" taskId={taskId} />}
    {message && <p className="form-message" role="status">{message}</p>}
  </section>
}

function AdminTools() {
  const [users, setUsers] = useState([])
  const [audit, setAudit] = useState([])
  const [statuses, setStatuses] = useState({})
  const [message, setMessage] = useState('')
  const load = () => Promise.all([request('/admin/overview'), request('/admin/audit-log')]).then(([overview, log]) => { setUsers(overview.users.filter((item) => item.role !== 'admin')); setAudit(log) }).catch((error) => setMessage(error.message))
  useEffect(() => { load() }, [])
  const updateStatus = async (userId, status) => {
    try { await request(`/admin/users/${userId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); setStatuses({ ...statuses, [userId]: status }); setMessage(`User ${status}.`); load() } catch (error) { setMessage(error.message) }
  }
  return <section className="page-width admin-tools-section"><div className="admin-tools-grid"><div className="panel"><div className="panel-heading"><div><p className="eyebrow">Safety controls</p><h2>User access</h2></div></div><div className="admin-control-list">{users.slice(0, 12).map((item) => <div className="admin-control-row" key={item.id}><span><strong>{item.name}</strong><small>{item.email} &middot; {item.role}</small></span><button className="quiet-button" type="button" onClick={() => updateStatus(item.id, statuses[item.id] === 'suspended' ? 'active' : 'suspended')}>{statuses[item.id] === 'suspended' ? 'Reactivate' : 'Suspend'}</button></div>)}</div></div><div className="panel"><div className="panel-heading"><div><p className="eyebrow">Accountability</p><h2>Recent admin actions</h2></div></div><div className="admin-audit-list">{audit.slice(0, 8).map((item) => <div key={item.id}><strong>{item.action.replace('_', ' ')}</strong><span>{item.details || item.targetType} &middot; {new Date(item.createdAt).toLocaleString()}</span></div>)}</div>{!audit.length && <p className="muted-label">Admin actions will appear here.</p>}</div></div>{message && <p className="form-message">{message}</p>}</section>
}

function ArchivedUsersPanel() {
  const [archives, setArchives] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const load = () => request('/admin/archived-users').then(setArchives).catch((error) => setMessage(error.message)).finally(() => setLoading(false))
  useEffect(() => { load() }, [])
  const restore = async (archiveId) => {
    if (!window.confirm('Restore this archived account and its saved history?')) return
    try {
      const result = await request(`/admin/archived-users/${archiveId}/restore`, { method: 'PATCH' })
      setMessage(result.message)
      load()
    } catch (error) {
      setMessage(error.message)
    }
  }
  const permanentlyDelete = async (archive) => {
    if (!window.confirm(`Permanently delete ${archive.username}'s archived account and saved marketplace history? This cannot be undone.`)) return
    try {
      const result = await request(`/admin/archived-users/${archive.id}`, { method: 'DELETE' })
      setMessage(result.message)
      load()
    } catch (error) {
      setMessage(error.message)
    }
  }
  return <section className="page-width archive-section"><div className="panel"><div className="panel-heading"><div><p className="eyebrow">Two-stage deletion</p><h2>Archived accounts</h2><p className="muted-label">Restore an account, or permanently delete its saved data. Permanent deletion cannot be undone.</p></div><span className="count-badge">{archives.length}</span></div>{loading ? <LoadingState text="Loading archived accounts..." /> : archives.length ? <div className="table-wrap"><table className="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Archived</th><th>Reason</th><th>Actions</th></tr></thead><tbody>{archives.map((archive) => <tr key={archive.id}><td>{archive.username}</td><td>{archive.email}</td><td><span className="table-status">{archive.role}</span></td><td>{new Date(archive.archivedAt).toLocaleString()}</td><td>{archive.reason}</td><td><div className="archive-actions"><button className="quiet-button" type="button" onClick={() => restore(archive.id)}>Restore</button><button className="quiet-button danger-button" type="button" onClick={() => permanentlyDelete(archive)}>Delete permanently</button></div></td></tr>)}</tbody></table></div> : <EmptyState text="No accounts have been archived." />}{message && <p className="form-message">{message}</p>}</div></section>
}

function AdminReportsPanel() {
  const [reports, setReports] = useState([])
  const [notes, setNotes] = useState({})
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const load = () => request('/admin/reports').then(setReports).catch((error) => setMessage(error.message)).finally(() => setLoading(false))
  useEffect(() => { load() }, [])
  const update = async (report, status) => {
    try {
      const result = await request(`/admin/reports/${report.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, resolutionNote: notes[report.id] || '' }),
      })
      setMessage(result.message)
      await load()
    } catch (error) {
      setMessage(error.message)
    }
  }
  return <section className="page-width admin-reports-section"><div className="panel"><div className="panel-heading"><div><p className="eyebrow">Trust & safety</p><h2>Reports and disputes</h2><p className="muted-label">Review service disputes, profiles, tasks, and reported messages. Record a note when resolving or dismissing a case.</p></div><span className="count-badge">{reports.filter((report) => ['open', 'reviewing'].includes(report.status)).length} open</span></div>
    {loading ? <LoadingState text="Loading reports..." /> : reports.length ? <div className="admin-report-list">{reports.map((report) => <article className="admin-report-card" key={report.id}>
      <header><span className="request-category">{report.reportType} · {report.category}</span><span className={`dashboard-status status-${report.status}`}>{report.status}</span></header>
      <p>{report.description}</p>
      <div className="muted-label">Reported by {report.reporterName || 'Former member'} · {report.targetName ? `About ${report.targetName}` : 'Target unavailable'} · {new Date(report.createdAt).toLocaleString()}</div>
      {report.taskDetail && <p className="report-context"><strong>Task:</strong> {report.taskDetail}</p>}
      {report.reportedMessage && <blockquote className="report-context">{report.reportedMessage}</blockquote>}
      {report.resolutionNote && <p className="report-context"><strong>Admin note:</strong> {report.resolutionNote}</p>}
      {!['resolved', 'dismissed'].includes(report.status) && <div className="admin-report-actions">
        <label>Review note<input maxLength="500" value={notes[report.id] || ''} onChange={(event) => setNotes({ ...notes, [report.id]: event.target.value })} placeholder="Required to resolve or dismiss" /></label>
        <button className="quiet-button" type="button" onClick={() => update(report, 'reviewing')}>Mark reviewing</button>
        <button className="small-button" type="button" disabled={(notes[report.id] || '').trim().length < 5} onClick={() => update(report, 'resolved')}>Resolve</button>
        <button className="quiet-button danger-button" type="button" disabled={(notes[report.id] || '').trim().length < 5} onClick={() => update(report, 'dismissed')}>Dismiss</button>
      </div>}
    </article>)}</div> : <EmptyState text="No user reports or disputes have been submitted." />}
    {message && <p className="form-message" role="status">{message}</p>}
  </div></section>
}

function MessagesPanel() {
  const [conversations, setConversations] = useState([])
  const [selectedTask, setSelectedTask] = useState(() => Number(getRouteQueryValue('taskId')) || null)
  const [messages, setMessages] = useState([])
  const [body, setBody] = useState('')
  const [message, setMessage] = useState('')
  const loadConversations = () => request('/messages').then((items) => { setConversations(items); setSelectedTask((current) => items.some((item) => Number(item.taskId) === Number(current)) ? current : current ? items[0]?.taskId || null : items[0]?.taskId || null) }).catch(() => setConversations([]))
  useEffect(() => { loadConversations() }, [])
  useEffect(() => { if (selectedTask) request(`/messages/${selectedTask}`).then(setMessages).catch(() => setMessages([])) }, [selectedTask])
  const send = async (event) => {
    event.preventDefault()
    if (!selectedTask || !body.trim()) return
    try { await request(`/messages/${selectedTask}`, { method: 'POST', body: JSON.stringify({ body }) }); setBody(''); setMessage('Message sent.'); const items = await request(`/messages/${selectedTask}`); setMessages(items) } catch (error) { setMessage(error.message) }
  }
  if (!conversations.length) return <section className="page-width messages-section"><div className="panel"><div className="panel-heading"><div><p className="eyebrow">Private communication</p><h2>Messages</h2></div><span className="verified-label">Task-only</span></div><p className="muted-label">Messages with customers or technicians appear here after a bid is accepted.</p></div></section>
  return <section className="page-width messages-section"><div className="panel"><div className="panel-heading"><div><p className="eyebrow">Private communication</p><h2>Messages</h2></div><span className="verified-label">Task-only</span></div><div className="messages-layout"><div className="conversation-list">{conversations.map((conversation) => <button className={selectedTask === conversation.taskId ? 'conversation-button active' : 'conversation-button'} type="button" key={conversation.taskId} data-task-id={conversation.taskId} onClick={() => setSelectedTask(conversation.taskId)}><strong>{conversation.detail}</strong><span>{conversation.status.replace('_', ' ')}</span></button>)}</div><div className="message-thread">{messages.length ? messages.map((item) => <div className="message-bubble" key={item.id}><strong>{item.senderName}</strong><p>{item.body}</p><small>{new Date(item.createdAt).toLocaleString()}</small>{Number(item.senderId) !== Number(getStoredUser()?.id) && <ReportForm reportType="message" taskId={selectedTask} messageId={item.id} />}</div>) : <p className="muted-label">Start the conversation for this accepted task.</p>}<form className="message-form" onSubmit={send}><input value={body} maxLength="1000" onChange={(event) => setBody(event.target.value)} placeholder="Write a message..." /><button className="small-button" type="submit">Send</button></form>{message && <p className="form-message">{message}</p>}</div></div></div></section>
}

function RequestsPage({ posts, user }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All categories')
  const [sort, setSort] = useState('newest')
  const categories = ['All categories', ...new Set(posts.map((post) => post.category?.trim().toLowerCase()).filter(Boolean))]
  const visiblePosts = [...posts]
    .filter((post) => category === 'All categories' || post.category?.trim().toLowerCase() === category)
    .filter((post) => `${post.detail} ${post.category} ${post.subCategory || ''}`.toLowerCase().includes(query.toLowerCase().trim()))
    .sort((first, second) => sort === 'oldest' ? new Date(first.createdAt) - new Date(second.createdAt) : new Date(second.createdAt) - new Date(first.createdAt))

  return <Shell user={user}><section className="page-heading page-width"><p className="eyebrow">Marketplace</p><h1>Requests from your neighbourhood.</h1><p>Find a job that matches your skills, or see what help is available nearby.</p></section><section className="request-section page-width"><div className="marketplace-toolbar"><label className="search-field">Search requests<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try AC repair or plumbing" /></label><label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item} value={item}>{item === 'All categories' ? item : `${item.slice(0, 1).toUpperCase()}${item.slice(1)}`}</option>)}</select></label><label>Sort<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label></div><div className="marketplace-summary"><span>{visiblePosts.length} {visiblePosts.length === 1 ? 'request' : 'requests'} found</span>{query && <button className="quiet-button" type="button" onClick={() => setQuery('')}>Clear search</button>}</div><div className="request-grid">{visiblePosts.map((post) => <RequestCard key={post.id} post={post} action={user?.role === 'technician' ? <button className="small-button" type="button" onClick={() => go('/technician')}>Make an offer</button> : null} />)}</div>{!visiblePosts.length && <EmptyState text={posts.length ? 'No requests match those filters.' : 'No requests are available right now.'} />}</section></Shell>
}

function TechniciansPage({ user }) {
  const [technicians, setTechnicians] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [location, setLocation] = useState('')
  const [availability, setAvailability] = useState('')
  const [sort, setSort] = useState('relevance')

  useEffect(() => {
    let active = true
    const query = new URLSearchParams({ search, location, availability, sort })
    request(`/technicians?${query}`)
      .then((data) => {
        if (!Array.isArray(data.items)) throw new Error('The technician list could not be read.')
        if (active) setTechnicians(data.items)
      })
      .catch((requestError) => { if (active) setError(requestError.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [search, location, availability, sort])

  return <Shell user={user}>
    <section className="page-heading page-width">
      <p className="eyebrow">Approved professionals</p>
      <h1>Find a technician you can trust.</h1>
      <p>Browse technicians whose applications were reviewed by HelpLagbe. Approval is not an independent identity guarantee; contact details stay private until a job is accepted.</p>
    </section>
    <section className="request-section page-width">
      <div className="technician-filters">
        <label>Skills or name<input value={search} onChange={(event) => { setLoading(true); setError(''); setSearch(event.target.value) }} placeholder="Plumbing, AC repair..." /></label>
        <label>Service area<input value={location} onChange={(event) => { setLoading(true); setError(''); setLocation(event.target.value) }} placeholder="Dhanmondi, Dhaka" /></label>
        <label>Availability<input value={availability} onChange={(event) => { setLoading(true); setError(''); setAvailability(event.target.value) }} placeholder="Weekdays, evenings..." /></label>
        <label>Sort by<select value={sort} onChange={(event) => { setLoading(true); setError(''); setSort(event.target.value) }}><option value="relevance">Best match</option><option value="rating">Highest rated</option><option value="response">Fastest response</option><option value="completed">Most completed jobs</option></select></label>
      </div>
      {loading
        ? <LoadingState text="Loading approved technicians..." />
        : error
          ? <p className="form-message" role="alert">{error}</p>
          : technicians.length
            ? <div className="technician-grid">{technicians.map((technician) => <article className="technician-card" key={technician.id}>
              <ProfileAvatar className="technician-avatar" name={technician.name} image={technician.profileImage} />
              <div>
                <div className="technician-card-heading"><h2>{technician.name}</h2><span className="verified-label">Application approved</span></div>
                <p>{technician.skills}</p>
                <div className="technician-stats">
                  <span className="completed-count">{technician.completedJobs} completed {Number(technician.completedJobs) === 1 ? 'job' : 'jobs'}</span>
                  <span>{technician.averageRating ? `${technician.averageRating}/5 rating` : 'New to reviews'}</span>
                  {technician.reviewCount > 0 && <span>{technician.reviewCount} {Number(technician.reviewCount) === 1 ? 'review' : 'reviews'}</span>}
                  {technician.location && <span>{technician.location}</span>}
                  {technician.availability && <span>{technician.availability}</span>}
                  {technician.averageResponseMinutes != null && <span>Typical first-offer time: {Number(technician.averageResponseMinutes) < 60 ? `${technician.averageResponseMinutes} min` : `${(Number(technician.averageResponseMinutes) / 60).toFixed(1)} hr`}</span>}
                </div>
                {user && technician.id && <ReportForm reportType="profile" technicianId={technician.id} />}
              </div>
            </article>)}</div>
            : <EmptyState text="No approved technicians are available yet." />}
    </section>
  </Shell>
}

function AuthPage({ mode }) {
  const isRegister = mode !== 'login'
  const [accountType, setAccountType] = useState(mode === 'technician' ? 'technician' : 'customer')
  const isTechnician = isRegister && accountType === 'technician'
  const [form, setForm] = useState({ email: '', password: '', username: '', nationalId: '', skills: '', address: '', phone: '' })
  const [message, setMessage] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const submit = async (event) => {
    event.preventDefault()
    setMessage('Working...')
    try {
      const endpoint = mode === 'login' ? '/auth/login' : isTechnician ? '/auth/register-technician' : '/auth/register'
      const data = await request(endpoint, { method: 'POST', body: JSON.stringify(form) })
      if (mode === 'login') {
        localStorage.setItem('helplagbe_token', data.token)
        localStorage.setItem('helplagbe_user', JSON.stringify(data.user))
        window.dispatchEvent(new Event('helplagbe-auth'))
        go(`/${data.user.role}`)
      } else {
        setMessage(isTechnician ? 'Application submitted. You can log in after approval.' : 'Account created. You can now log in.')
        setForm({ ...form, password: '' })
      }
    } catch (error) { setMessage(error.message) }
  }
  return <Shell><section className="auth-page"><div className="auth-panel"><p className="eyebrow">HelpLagbe account</p><h1>{mode === 'login' ? 'Welcome back.' : isTechnician ? 'Put your skills to work.' : 'Start getting help.'}</h1><p className="auth-intro">{mode === 'login' ? 'Sign in to continue to your workspace.' : isTechnician ? 'Apply to join trusted technicians on HelpLagbe.' : 'Create an account and get your next job moving.'}</p><form onSubmit={submit}>{isRegister && <label>Account type<select value={accountType} onChange={(event) => setAccountType(event.target.value)}><option value="customer">Customer</option><option value="technician">Technician</option></select></label>}{isRegister && <label>Name<input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required /></label>}<label>Email<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></label>{isRegister && <label>Phone number <span className="muted-label">(optional; can be added later in Edit profile)</span><input type="tel" maxLength="20" autoComplete="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>}<label>Password<div className="password-input-wrap"><input type={showPassword ? 'text' : 'password'} minLength="8" maxLength="72" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required /><button className="password-toggle" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? 'Hide' : 'Show'}</button></div></label>{isTechnician && <><label>National ID<input value={form.nationalId} onChange={(event) => setForm({ ...form, nationalId: event.target.value })} required /></label><label>Skills<textarea rows="3" value={form.skills} onChange={(event) => setForm({ ...form, skills: event.target.value })} required /></label><label>Address<input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></label></>}<button className="primary-button auth-submit" type="submit">{mode === 'login' ? 'Log in' : isTechnician ? 'Submit application' : 'Create account'}</button></form>{message && <p className="form-message">{message}</p>}<div className="auth-links">{mode === 'login' ? <><button type="button" onClick={() => go('/register')}>Need an account? Register</button><button type="button" onClick={() => go('/register-technician')}>Join as a technician</button></> : <button type="button" onClick={() => go('/login')}>Already registered? Log in</button>}</div></div><div className="auth-side"><span className="side-mark">H</span><h2>Help that fits real life.</h2><p>One trusted place for customers, technicians, and the people who keep homes running.</p></div></section></Shell>
}

function ProfileEditor({ user }) {
  const [profile, setProfile] = useState({ name: user.name || '', email: user.email || '', phone: '', address: '', skills: '', serviceArea: '', availability: '', profileImage: null })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [photoChanged, setPhotoChanged] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true
    request('/profile')
      .then((data) => {
        if (active) setProfile({ name: data.name || '', email: data.email || '', phone: data.phone || '', address: data.address || '', skills: data.skills || '', serviceArea: data.serviceArea || '', availability: data.availability || '', profileImage: data.profileImage || null })
      })
      .catch((error) => { if (active) setMessage(error.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const save = async (event) => {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    try {
      const updates = { ...profile, profileImage: photoChanged ? profile.profileImage : undefined }
      const data = await request('/profile', { method: 'PATCH', body: JSON.stringify(updates) })
      setProfile((current) => ({ ...current, ...data.user }))
      setPhotoChanged(false)
      const storedUser = getStoredUser()
      if (storedUser) {
        localStorage.setItem('helplagbe_user', JSON.stringify({ ...storedUser, name: data.user.name, email: data.user.email, profileImage: data.user.profileImage }))
        window.dispatchEvent(new Event('helplagbe-auth'))
      }
      setMessage(data.message)
    } catch (error) {
      setMessage(error.message)
    } finally {
      setSaving(false)
    }
  }

  return <section className="panel profile-editor">
    <div className="panel-heading"><div><p className="eyebrow">Your account</p><h2>Edit profile</h2><p className="muted-label">Update the details associated with your HelpLagbe account.</p></div></div>
    {loading ? <LoadingState text="Loading your profile..." /> : <form className="request-form profile-form" onSubmit={save}>
    <div className="profile-photo-control">
      <ProfileAvatar className="profile-photo-preview" name={profile.name} image={profile.profileImage} />
      <div>
        <label>Profile photo<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
            setMessage('Choose a JPG, PNG, or WebP image.')
            return
          }
          if (file.size > 5 * 1024 * 1024) {
            setMessage('Profile photos must be 5MB or smaller.')
            return
          }
          const reader = new FileReader()
          reader.onload = () => {
            if (typeof reader.result === 'string') {
              setProfile((current) => ({ ...current, profileImage: reader.result }))
              setPhotoChanged(true)
              setMessage('')
            } else {
              setMessage('Could not read that profile photo.')
            }
          }
          reader.onerror = () => setMessage('Could not read that profile photo.')
          reader.readAsDataURL(file)
        }} /></label>
        <p className="muted-label">JPG, PNG, or WebP. Maximum 5MB.</p>
        {profile.profileImage && <button className="text-button" type="button" onClick={() => { setProfile((current) => ({ ...current, profileImage: null })); setPhotoChanged(true) }}>Remove photo</button>}
      </div>
    </div>
    <div className="form-row">
        <label>Name<input value={profile.name} maxLength="100" onChange={(event) => setProfile({ ...profile, name: event.target.value })} required /></label>
        <label>Email<input type="email" value={profile.email} onChange={(event) => setProfile({ ...profile, email: event.target.value })} required /></label>
      </div>
      <div className="form-row">
        <label>Phone<input type="tel" value={profile.phone} maxLength="20" onChange={(event) => setProfile({ ...profile, phone: event.target.value })} /></label>
        <label>Address<input value={profile.address} maxLength="500" onChange={(event) => setProfile({ ...profile, address: event.target.value })} /></label>
      </div>
      {user.role === 'technician' && <>
        <label>Skills<textarea rows="3" value={profile.skills} maxLength="1000" onChange={(event) => setProfile({ ...profile, skills: event.target.value })} required /></label>
        <div className="form-row">
          <label>Service area<input value={profile.serviceArea} maxLength="255" onChange={(event) => setProfile({ ...profile, serviceArea: event.target.value })} placeholder="e.g. Dhanmondi, Dhaka" /></label>
          <label>Availability<input value={profile.availability} maxLength="255" onChange={(event) => setProfile({ ...profile, availability: event.target.value })} placeholder="e.g. Weekdays, 9am–6pm" /></label>
        </div>
      </>}
      <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save profile'}</button>
      {message && <p className="form-message" role="status">{message}</p>}
    </form>}
  </section>
}

function DashboardLayout({ user, eyebrow, title, description, children }) {
  const hasSidebar = user.role === 'customer' || user.role === 'technician' || user.role === 'admin'
  const requestedSection = getRouteQueryValue('section')
  const requestedTaskId = getRouteQueryValue('taskId')
  const [activeSection, setActiveSection] = useState(requestedSection || (user.role === 'admin' ? 'admin-overview' : 'dashboard-overview'))
  const navigation = user.role === 'admin'
    ? [['admin-overview', 'Overview'], ['admin-applications', 'Applications'], ['admin-users', 'Users'], ['admin-requests', 'Requests'], ['admin-tasks', 'Tasks'], ['admin-technicians', 'Technicians'], ['admin-reports', 'Reports & disputes'], ['admin-safety', 'Safety & audit'], ['admin-archive', 'Archived accounts'], ['dashboard-profile', 'Edit profile']]
    : user.role === 'customer'
    ? [['dashboard-overview', 'Overview'], ['customer-requests', 'My requests'], ['dashboard-messages', 'Messages'], ['dashboard-reviews', 'Reviews'], ['dashboard-profile', 'Edit profile']]
    : [['dashboard-overview', 'Overview'], ['technician-opportunities', 'Opportunities'], ['technician-offers', 'My offers'], ['technician-active', 'Active jobs'], ['technician-history', 'Work history'], ['dashboard-messages', 'Messages'], ['dashboard-profile', 'Edit profile']]
  const sectionDescriptions = {
    'admin-overview': 'A live snapshot of marketplace activity and account health.',
    'admin-applications': 'Review and decide on technician applications.',
    'admin-users': 'Find accounts and archive users when necessary.',
    'admin-requests': 'Review active service requests across the marketplace.',
    'admin-tasks': 'Monitor bids and manage job status.',
    'admin-technicians': 'Review technician profiles and approval status.',
    'admin-reports': 'Review safety concerns, task problems, and payment disputes.',
    'admin-safety': 'Manage access controls and review recent admin actions.',
    'admin-archive': 'Restore archived accounts or permanently remove them.',
    'dashboard-overview': 'A quick snapshot of your activity and what needs attention.',
    'customer-requests': 'Track your requests, review offers, or post a new job.',
    'dashboard-messages': 'Keep conversations about accepted jobs in one place.',
    'dashboard-reviews': 'Share feedback about completed work.',
    'dashboard-profile': 'Keep your contact details and account photo up to date.',
    'technician-opportunities': 'Browse open requests and send customers an offer.',
    'technician-offers': 'Review and update offers you have already sent.',
    'technician-active': 'Manage the jobs customers have accepted.',
    'technician-history': 'Look back at completed and closed jobs.',
  }
  useEffect(() => {
    if (!/^\d+$/.test(requestedTaskId || '')) return undefined
    const root = document.querySelector('.dashboard-content')
    if (!root) return undefined
    const selector = `[data-task-id="${requestedTaskId}"]`
    const revealTarget = () => {
      const target = root.querySelector(selector)
      if (!target) return false
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target.classList.add('task-notification-target')
      return true
    }
    if (revealTarget()) return undefined
    const observer = new MutationObserver(() => {
      if (revealTarget()) observer.disconnect()
    })
    observer.observe(root, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [requestedTaskId, activeSection])
  const activeLabel = navigation.find(([id]) => id === activeSection)?.[1] || 'Overview'
  const dashboardContent = <>
    {user.role === 'customer' && <section className="dashboard-anchor" id="dashboard-reviews" data-dashboard-section="dashboard-reviews" aria-label="Reviews"><ReviewPanel active={activeSection === 'dashboard-reviews'} /></section>}
    {user.role !== 'admin' && <div id="dashboard-messages" data-dashboard-section="dashboard-messages"><MessagesPanel key={requestedTaskId || 'default'} /></div>}
    {user.role === 'admin' && <div data-dashboard-section="admin-reports"><AdminReportsPanel /></div>}
    {user.role === 'admin' && <div data-dashboard-section="admin-safety"><AdminTools /></div>}
    {user.role === 'admin' && <div data-dashboard-section="admin-archive"><ArchivedUsersPanel /></div>}
    {children}
    <div id="dashboard-profile" data-dashboard-section="dashboard-profile"><ProfileEditor user={user} /></div>
  </>

  return <Shell user={user}>
    <section className="dashboard-heading page-width"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div><div className="profile-chip"><ProfileAvatar name={user.name} image={user.profileImage} /><span><strong>{user.name}</strong><small>{user.email}</small></span></div></section>
    {hasSidebar
      ? <div className="dashboard-layout page-width">
        <aside className="dashboard-sidebar"><p className="eyebrow">Workspace</p><nav aria-label={`${user.role} dashboard`}>{navigation.map(([id, label]) => <button key={id} type="button" aria-current={activeSection === id ? 'page' : undefined} onClick={() => setActiveSection(id)}>{label}</button>)}</nav></aside>
        <div className="dashboard-content" data-active-section={activeSection} aria-labelledby="dashboard-section-title">
          <header className="dashboard-section-heading">
            <div><p className="eyebrow">{user.role} workspace</p><h2 id="dashboard-section-title">{activeLabel}</h2><p>{sectionDescriptions[activeSection]}</p></div>
            <span className="dashboard-section-count">{String(navigation.findIndex(([id]) => id === activeSection) + 1).padStart(2, '0')}<span> / {String(navigation.length).padStart(2, '0')}</span></span>
          </header>
          {dashboardContent}
        </div>
      </div>
      : children}
  </Shell>
}

function CustomerDashboard({ user }) {
  const [posts, setPosts] = useState([])
  const [form, setForm] = useState({ detail: '', category: 'Appliance', subCategory: '', serviceAddress: '', building: '', flatNo: '' })
  const [imageData, setImageData] = useState('')
  const [imageName, setImageName] = useState('')
  const [message, setMessage] = useState('')
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')

  const load = async () => {
    try {
      setPosts(await request('/customer/posts'))
      setLoadError('')
    } catch (error) {
      setLoadError(error.message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    request('/customer/posts').then(setPosts).catch((error) => setLoadError(error.message)).finally(() => setLoading(false))
  }, [])

  const groupedPosts = [...new Map(posts.map((post) => [post.id, post])).values()]
  const counts = {
    requests: groupedPosts.length,
    attention: posts.filter((post) => post.status === 'pending').length,
    active: posts.filter((post) => ['accepted', 'scheduled', 'in_progress'].includes(post.status)).length,
    completed: posts.filter((post) => post.status === 'completed').length,
  }
  const visiblePosts = groupedPosts.filter((post) => {
    const terms = `${post.detail} ${post.category} ${post.technicianName || ''}`.toLowerCase()
    const matchesSearch = terms.includes(search.trim().toLowerCase())
    const matchesFilter = filter === 'all'
      || (filter === 'attention' && posts.some((bid) => bid.id === post.id && bid.status === 'pending'))
      || (filter === 'active' && posts.some((bid) => bid.id === post.id && ['accepted', 'scheduled', 'in_progress'].includes(bid.status)))
      || (filter === 'completed' && posts.some((bid) => bid.id === post.id && bid.status === 'completed'))
    return matchesSearch && matchesFilter
  })

  const submit = async (event) => {
    event.preventDefault()
    setMessage('Posting request...')
    try {
      await request('/posts', { method: 'POST', body: JSON.stringify({ ...form, imageData }) })
      setForm({ detail: '', category: 'Appliance', subCategory: '', serviceAddress: '', building: '', flatNo: '' })
      setImageData('')
      setImageName('')
      setMessage('Request posted successfully.')
      setShowForm(false)
      await load()
    } catch (error) {
      setMessage(error.message)
    }
  }

  const updateBid = async (taskId, status) => {
    const bid = posts.find((item) => item.taskId === taskId)
    if (status === 'accepted' && !bid?.serviceAddress?.trim()) {
      setMessage("Add this request's service address before accepting an offer.")
      return
    }
    try {
      await request(`/tasks/${taskId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })
      setMessage(status === 'accepted' ? 'Bid accepted.' : 'Bid declined.')
      await load()
    } catch (error) {
      setMessage(error.message)
    }
  }

  return <DashboardLayout user={user} eyebrow="Customer workspace" title="Your service requests." description="Track offers, active work, and completed jobs in one place.">
    <section className="customer-dashboard page-width" id="dashboard-overview" data-dashboard-section="dashboard-overview">
      <div className="dashboard-summary" aria-label="Request summary">
        <div><strong>{counts.requests}</strong><span>Requests</span></div>
        <div><strong>{counts.attention}</strong><span>Bids to review</span></div>
        <div><strong>{counts.active}</strong><span>Active jobs</span></div>
        <div><strong>{counts.completed}</strong><span>Completed</span></div>
      </div>
    </section>
    <section className="customer-dashboard page-width" id="customer-requests" data-dashboard-section="customer-requests">
      <div className="dashboard-toolbar">
        <div className="dashboard-filter-group" role="group" aria-label="Filter requests">
          {[['all', 'All'], ['attention', 'Needs attention'], ['active', 'Active'], ['completed', 'Completed']].map(([value, label]) => <button key={value} type="button" className={filter === value ? 'filter-chip is-active' : 'filter-chip'} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
        </div>
        <label className="dashboard-search">Search requests<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Description or category" /></label>
        <button className="primary-button" type="button" onClick={() => { setShowForm((visible) => !visible); setMessage('') }}>{showForm ? 'Close form' : 'New request'}</button>
      </div>
      {showForm && <div className="panel request-create-panel"><div className="panel-heading"><div><p className="eyebrow">New request</p><h2>What needs doing?</h2></div></div><form className="request-form" onSubmit={submit}><label>Describe the job<textarea rows="4" maxLength="2000" value={form.detail} onChange={(event) => setForm({ ...form, detail: event.target.value })} required placeholder="Tell technicians what needs fixing..." /><span className="muted-label">Do not include your phone number, email, or exact address here. The address section is private until a technician is selected.</span></label><div className="form-row"><label>Category<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option>Appliance</option><option>Plumbing</option><option>Electrical</option><option>Home maintenance</option><option>Computer</option></select></label><label>Subcategory<input maxLength="100" value={form.subCategory} onChange={(event) => setForm({ ...form, subCategory: event.target.value })} placeholder="Optional" /></label></div><fieldset className="request-location-fields"><legend>Where should the technician come?</legend><label>Service address <span className="muted-label">(street, area, city)</span><input autoComplete="street-address" maxLength="500" value={form.serviceAddress} onChange={(event) => setForm({ ...form, serviceAddress: event.target.value })} required placeholder="Road, neighbourhood, city" /></label><div className="form-row"><label>Building / house name <span className="muted-label">(optional)</span><input maxLength="150" value={form.building} onChange={(event) => setForm({ ...form, building: event.target.value })} placeholder="Building or house name" /></label><label>Flat / unit number <span className="muted-label">(optional)</span><input maxLength="100" value={form.flatNo} onChange={(event) => setForm({ ...form, flatNo: event.target.value })} placeholder="Flat or unit" /></label></div><p className="muted-label">Your exact address stays private from other customers and technicians who have not been selected for this job.</p></fieldset><label className="file-field">Photo (optional)<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 5 * 1024 * 1024) { setMessage('Image must be 5MB or smaller.'); return } const reader = new FileReader(); reader.onload = () => { setImageData(reader.result); setImageName(file.name) }; reader.readAsDataURL(file) }} /></label>{imageName && <span className="file-name">Attached: {imageName}</span>}<button className="primary-button" type="submit">Post request</button></form></div>}
      {message && <p className="form-message" role="status">{message}</p>}
      {loading ? <LoadingState text="Loading your requests..." /> : loadError ? <div className="dashboard-error" role="alert"><p>{loadError}</p><button className="small-button" type="button" onClick={load}>Retry</button></div> : visiblePosts.length ? <div className="customer-request-list">{visiblePosts.map((post) => {
        const bids = posts.filter((bid) => bid.id === post.id && bid.taskId)
        const acceptedBid = bids.find((bid) => ['accepted', 'scheduled', 'in_progress', 'completed', 'cancelled'].includes(bid.status))
        const hasAttention = bids.some((bid) => bid.status === 'pending')
        const state = bids.find((bid) => ['accepted', 'scheduled', 'in_progress'].includes(bid.status))?.status
          || (bids.some((bid) => bid.status === 'completed') ? 'completed' : bids.some((bid) => bid.status === 'cancelled') ? 'cancelled' : 'waiting')
        return <article className="customer-request-item" key={post.id}>
          <div className="customer-request-heading"><div>{post.image && <img className="activity-image" src={getAssetUrl(post.image)} alt="Attached request" />}<span className="request-category">{post.category}</span><h2>{post.detail}</h2><span className="muted-label">{bids.length} {bids.length === 1 ? 'bid' : 'bids'} · {bids.filter((bid) => bid.status === 'pending').length} pending</span></div><span className={`dashboard-status status-${post.closedAt ? 'closed' : state}`}>{post.closedAt ? 'Closed' : hasAttention ? 'Review bids' : state === 'waiting' ? 'Waiting for bids' : state.replace('_', ' ')}</span></div>
          {post.serviceAddress && <p className="customer-request-location"><strong>Service location:</strong> {[post.serviceAddress, post.building, post.flatNo ? `Flat ${post.flatNo}` : ''].filter(Boolean).join(', ')}</p>}
          <CustomerRequestControls post={post} bids={bids} onUpdated={load} />
          {bids.length > 0 && <div className="customer-bid-list">{bids.map((bid) => <div className="customer-bid-entry" key={bid.taskId} data-task-id={bid.taskId}><div className="customer-bid-row"><div><strong>{bid.technicianName || 'Approved technician'}</strong><span>{bid.technicianSkills || 'Technician application approved'}{bid.proposedAt ? ` · Proposed ${new Date(bid.proposedAt).toLocaleString()}` : ' · Appointment time not provided'}</span></div><strong className="bid-price">৳{bid.price}</strong>{bid.status === 'pending' ? <div className="bid-actions"><button className="small-button" type="button" onClick={() => updateBid(bid.taskId, 'accepted')}>Accept</button><button className="quiet-button" type="button" onClick={() => updateBid(bid.taskId, 'rejected')}>Decline</button></div> : <span className={`table-status status-${bid.status}`}>{bid.status.replace('_', ' ')}</span>}</div>{bid.priceDetails && <p className="offer-price-details"><strong>Price includes:</strong> {bid.priceDetails}</p>}{bid.status === 'pending' && <PendingTechnicianOverview taskId={bid.taskId} />}{['pending', 'accepted', 'scheduled', 'in_progress', 'completed', 'cancelled', 'rejected', 'withdrawn'].includes(bid.status) && <TaskLifecyclePanel task={bid} userRole="customer" onUpdated={load} />}</div>)}</div>}
          {acceptedBid && <AcceptedTechnicianProfile technician={acceptedBid} />}
        </article>
      })}</div> : <EmptyState text={posts.length ? 'No requests match your filters.' : 'Your requests will appear here after you post one.'} />}
    </section>
  </DashboardLayout>
}

function TechnicianDashboard({ user }) {
  const [requests, setRequests] = useState([])
  const [tasks, setTasks] = useState([])
  const [prices, setPrices] = useState({})
  const [priceDetails, setPriceDetails] = useState({})
  const [scheduleDrafts, setScheduleDrafts] = useState({})
  const [message, setMessage] = useState('')
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [localMatchesOnly, setLocalMatchesOnly] = useState(false)
  const load = async () => {
    try {
      const [available, current] = await Promise.all([request('/technician/requests'), request('/technician/tasks')])
      setRequests(available)
      setTasks(current)
      setLoadError('')
    } catch (error) {
      setLoadError(error.message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    Promise.all([request('/technician/requests'), request('/technician/tasks')])
      .then(([available, current]) => { setRequests(available); setTasks(current) })
      .catch((error) => setLoadError(error.message))
      .finally(() => setLoading(false))
  }, [])
  const bid = async (postId) => {
    const price = Number(prices[postId])
    if (!Number.isFinite(price) || price <= 0 || Math.round(price * 100) !== price * 100) { setMessage('Enter a positive price with at most two decimal places.'); return }
    if (!scheduleDrafts[postId]) { setMessage('Choose your proposed appointment date and time.'); return }
    if ((priceDetails[postId] || '').trim().length < 10) { setMessage('Explain what the price includes and whether it may change.'); return }
    try { await request('/tasks/bid', { method: 'POST', body: JSON.stringify({ postId, price, priceDetails: priceDetails[postId], proposedAt: dateTimeToIso(scheduleDrafts[postId]) }) }); setMessage('Offer and proposed appointment sent.'); await load() } catch (error) { setMessage(error.message) }
  }
  const withdrawOffer = async (taskId) => {
    const reason = window.prompt('Why are you withdrawing this offer? (At least 5 characters)')
    if (reason === null) return
    if (reason.trim().length < 5) { setMessage('Provide a withdrawal reason of at least 5 characters.'); return }
    try {
      const result = await request(`/technician/tasks/${taskId}/withdraw`, { method: 'POST', body: JSON.stringify({ reason }) })
      setMessage(result.message)
      await load()
    } catch (error) {
      setMessage(error.message)
    }
  }
  const updateTask = async (taskId, status) => { try { await request(`/technician/tasks/${taskId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); setMessage(status === 'completed' ? 'Job marked complete.' : 'Job started.'); await load() } catch (error) { setMessage(error.message) } }
  const categories = ['all', ...new Set(requests.map((item) => item.category).filter(Boolean))]
  const matchedRequests = requests.filter((item) => item.areaMatch)
  const matchingRequestList = localMatchesOnly ? matchedRequests : requests
  const visibleRequests = matchingRequestList.filter((item) => `${item.detail} ${item.category} ${item.subCategory || ''}`.toLowerCase().includes(query.trim().toLowerCase()) && (category === 'all' || item.category === category))
  const pendingBids = tasks.filter((task) => task.status === 'pending')
  const activeTasks = tasks.filter((task) => ['accepted', 'scheduled', 'in_progress'].includes(task.status))
  const completedTasks = tasks.filter((task) => ['completed', 'rejected', 'withdrawn', 'cancelled'].includes(task.status))
  return <DashboardLayout user={user} eyebrow="Technician workspace" title="Your work, clearly queued." description="Find suitable requests, manage offers, and move accepted jobs forward.">
    <section className="technician-dashboard page-width" id="dashboard-overview">
      <div className="dashboard-summary" data-dashboard-section="dashboard-overview" aria-label="Work summary"><div><strong>{requests.length}</strong><span>Open requests</span></div><div><strong>{pendingBids.length}</strong><span>Pending bids</span></div><div><strong>{activeTasks.length}</strong><span>Active jobs</span></div><div><strong>{tasks.filter((task) => task.status === 'completed').length}</strong><span>Completed</span></div></div>
      {message && <p className="form-message" role="status">{message}</p>}
      {loading ? <LoadingState text="Loading your work..." /> : loadError ? <div className="dashboard-error" role="alert"><p>{loadError}</p><button className="small-button" type="button" onClick={load}>Retry</button></div> : <>
        <section className="panel" id="technician-opportunities" data-dashboard-section="technician-opportunities"><div className="panel-heading"><div><p className="eyebrow">Opportunities</p><h2>Requests waiting for an offer</h2></div><span className="count-badge">{visibleRequests.length}</span></div><div className="dashboard-toolbar"><label className="dashboard-search">Search requests<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Description or category" /></label><label className="dashboard-search">Category<select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item} value={item}>{item === 'all' ? 'All categories' : item}</option>)}</select></label><label className="matching-toggle"><input type="checkbox" checked={localMatchesOnly} onChange={(event) => setLocalMatchesOnly(event.target.checked)} />Show matching service-area requests only ({matchedRequests.length})</label></div>{visibleRequests.length ? <div className="request-grid compact-grid">{visibleRequests.map((item) => <article className="request-card" key={item.id}><span className="request-category">{item.category}{item.areaMatch ? ' · Nearby match' : ''}</span><h3>{item.detail}</h3><p>{item.customerName || 'Anonymous customer'} · {item.subCategory || 'Service request'} · Posted {new Date(item.createdAt).toLocaleDateString()}</p><div className="offer-inputs"><label>Offer price<input type="number" min="0.01" step="0.01" placeholder="Your price" value={prices[item.id] || ''} onChange={(event) => setPrices({ ...prices, [item.id]: event.target.value })} /></label><label>Proposed appointment<input type="datetime-local" value={scheduleDrafts[item.id] || ''} onChange={(event) => setScheduleDrafts({ ...scheduleDrafts, [item.id]: event.target.value })} /></label><label className="offer-details-field">What does this include?<textarea rows="2" maxLength="500" minLength="10" value={priceDetails[item.id] || ''} onChange={(event) => setPriceDetails({ ...priceDetails, [item.id]: event.target.value })} placeholder="Labor, parts, call-out fee, and whether the price can change" required /></label><button className="small-button" type="button" onClick={() => bid(item.id)}>Send offer</button></div></article>)}</div> : <EmptyState text={requests.length ? 'No requests match those filters.' : 'There are no open requests right now.'} />}</section>
        <section className="panel" id="technician-offers" data-dashboard-section="technician-offers"><div className="panel-heading"><div><p className="eyebrow">Your offers</p><h2>Pending bids</h2></div><span className="count-badge">{pendingBids.length}</span></div>{pendingBids.length ? <div className="bid-editor-list">{pendingBids.map((task) => <div className="bid-editor-row" key={task.id} data-task-id={task.id}><div><strong>{task.detail}</strong><span>Current offer: ৳{task.price}</span></div><input type="number" min="0.01" step="0.01" aria-label={`Updated offer for ${task.detail}`} value={prices[`task-${task.id}`] ?? task.price} onChange={(event) => setPrices({ ...prices, [`task-${task.id}`]: event.target.value })} /><input type="datetime-local" aria-label={`Proposed appointment for ${task.detail}`} value={scheduleDrafts[`task-${task.id}`] ?? toDateTimeInputValue(task.proposedAt)} onChange={(event) => setScheduleDrafts({ ...scheduleDrafts, [`task-${task.id}`]: event.target.value })} /><textarea aria-label={`Price inclusions for ${task.detail}`} maxLength="500" minLength="10" value={priceDetails[`task-${task.id}`] ?? task.priceDetails ?? ''} onChange={(event) => setPriceDetails({ ...priceDetails, [`task-${task.id}`]: event.target.value })} placeholder="Labor, parts, call-out fee, price changes" /><div className="bid-editor-actions"><button className="small-button" type="button" onClick={async () => { const schedule = scheduleDrafts[`task-${task.id}`] ?? toDateTimeInputValue(task.proposedAt); const details = priceDetails[`task-${task.id}`] ?? task.priceDetails ?? ''; if (details.trim().length < 10) { setMessage('Explain what the price includes and whether it may change.'); return } try { await request(`/technician/tasks/${task.id}/bid`, { method: 'PATCH', body: JSON.stringify({ price: prices[`task-${task.id}`] ?? task.price, priceDetails: details, proposedAt: dateTimeToIso(schedule) }) }); setMessage('Offer updated.'); await load() } catch (error) { setMessage(error.message) } }}>Update offer</button><button className="quiet-button danger-button" type="button" onClick={() => withdrawOffer(task.id)}>Withdraw offer</button></div></div>)}</div> : <EmptyState text="Bids you place will appear here until the customer decides." />}</section>
        <section className="panel" id="technician-active" data-dashboard-section="technician-active"><div className="panel-heading"><div><p className="eyebrow">Task lifecycle</p><h2>Active jobs</h2></div><span className="count-badge">{activeTasks.length}</span></div>{activeTasks.length ? <div className="activity-list">{activeTasks.map((task) => <article className="activity-item task-activity-item" key={task.id} data-task-id={task.id}><div><span className="request-category">{task.category}</span><h3>{task.detail}</h3><span className="muted-label">Agreed price: ৳{task.agreedPrice ?? task.price}</span><TaskServiceLocation task={task} />{task.status === 'scheduled' && <button className="small-button" type="button" onClick={() => updateTask(task.id, 'in_progress')}>Start job</button>}{task.status === 'in_progress' && <button className="small-button" type="button" onClick={() => updateTask(task.id, 'completed')}>Mark complete</button>}</div><TaskLifecyclePanel task={task} userRole="technician" onUpdated={load} /></article>)}</div> : <EmptyState text="Accepted work will appear here." />}</section>
        <section className="panel history-panel" id="technician-history" data-dashboard-section="technician-history"><div className="panel-heading"><div><p className="eyebrow">Work history</p><h2>Completed and closed jobs</h2></div><span className="count-badge">{completedTasks.length}</span></div>{completedTasks.length > 0 ? <div className="activity-list">{completedTasks.map((task) => <article className="activity-item task-activity-item" key={task.id} data-task-id={task.id}><div><span className="request-category">{task.category}</span><h3>{task.detail}</h3><span className="muted-label">Agreed price: ৳{task.agreedPrice ?? task.price}</span><TaskServiceLocation task={task} /><span className={`dashboard-status status-${task.status}`}>{task.status.replace('_', ' ')}</span></div>{['completed', 'withdrawn', 'rejected'].includes(task.status) && <TaskLifecyclePanel task={task} userRole="technician" onUpdated={load} />}</article>)}</div> : <EmptyState text="Completed and closed jobs will appear here." />}</section>
      </>}
    </section>
  </DashboardLayout>
}

function AdminListPanel({ title, eyebrow, children, empty, sectionId }) {
  return <section className="admin-workspace-section" data-dashboard-section={sectionId}><div className="panel admin-list-panel"><div className="panel-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div></div>{children || <EmptyState text={empty} />}</div></section>
}

function AdminDashboard({ user }) {
  const [data, setData] = useState(null)
  const [message, setMessage] = useState('')
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [userSearch, setUserSearch] = useState('')
  const [userRole, setUserRole] = useState('all')
  const [requestSearch, setRequestSearch] = useState('')
  const [taskStatus, setTaskStatus] = useState('all')
  const load = async () => {
    try {
      setData(await request('/admin/overview'))
      setLoadError('')
    } catch (error) {
      setLoadError(error.message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    request('/admin/overview').then(setData).catch((error) => setLoadError(error.message)).finally(() => setLoading(false))
  }, [])
  const update = async (id, status) => { try { await request(`/admin/technicians/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); setMessage(`Technician ${status}.`); await load() } catch (error) { setMessage(error.message) } }
  const manageTask = async (id, status) => { try { await request(`/admin/tasks/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); setMessage(`Task marked ${status.replace('_', ' ')}.`); await load() } catch (error) { setMessage(error.message) } }
  const removePost = async (id) => { if (!window.confirm('Remove this service request and its bids?')) return; try { await request(`/admin/posts/${id}`, { method: 'DELETE' }); setMessage('Request removed.'); await load() } catch (error) { setMessage(error.message) } }
  const removeUser = async (id) => { if (!window.confirm('Move this account and its marketplace history to Archived accounts? You can restore it later or permanently delete it from there.')) return; try { await request(`/admin/users/${id}`, { method: 'DELETE' }); setMessage('User moved to Archived accounts.'); await load() } catch (error) { setMessage(error.message) } }
  const users = (data?.users || []).filter((item) => item.role !== 'admin' && (userRole === 'all' || item.role === userRole) && `${item.name} ${item.email}`.toLowerCase().includes(userSearch.trim().toLowerCase()))
  const requests = (data?.posts || []).filter((item) => `${item.detail} ${item.category} ${item.postedBy}`.toLowerCase().includes(requestSearch.trim().toLowerCase()))
  const tasks = (data?.tasks || []).filter((item) => taskStatus === 'all' || item.status === taskStatus)
  return <DashboardLayout user={user} eyebrow="Admin workspace" title="Keep the marketplace healthy." description="Review exceptions, oversee users, and keep requests moving.">
    <section className="admin-page page-width">
      {message && <p className="form-message" role="status">{message}</p>}
      {loading ? <LoadingState text="Loading marketplace overview..." /> : loadError ? <div className="dashboard-error" role="alert"><p>{loadError}</p><button className="small-button" type="button" onClick={load}>Retry</button></div> : data && <>
        <div className="dashboard-summary admin-summary" data-dashboard-section="admin-overview">{Object.entries(data.counts).map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label.replace(/([A-Z])/g, ' $1')}</span></div>)}</div>
        <AdminListPanel sectionId="admin-applications" eyebrow="Needs attention" title={`Technician applications (${data.pendingTechnicians.length})`} empty="No pending technician applications.">{data.pendingTechnicians.length > 0 && <div className="activity-list">{data.pendingTechnicians.map((technician) => <article className="activity-item" key={technician.id}><div><span className="request-category">Application · {technician.address || 'Area not provided'}</span><h3>{technician.name}</h3><p>{technician.skills}</p></div><div className="bid-actions"><button className="small-button" type="button" onClick={() => update(technician.id, 'approved')}>Approve</button><button className="quiet-button" type="button" onClick={() => update(technician.id, 'rejected')}>Reject</button></div></article>)}</div>}</AdminListPanel>
        <AdminListPanel sectionId="admin-users" eyebrow="Directory" title={`Users (${users.length})`} empty="No users match those filters."><div className="dashboard-toolbar"><label className="dashboard-search">Search users<input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Name or email" /></label><label className="dashboard-search">Role<select value={userRole} onChange={(event) => setUserRole(event.target.value)}><option value="all">All roles</option><option value="customer">Customers</option><option value="technician">Technicians</option></select></label></div>{users.length > 0 && <div className="table-wrap"><table className="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th>Action</th></tr></thead><tbody>{users.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.email}</td><td><span className="table-status">{item.role}</span></td><td>{new Date(item.createdAt).toLocaleDateString()}</td><td><button className="quiet-button" type="button" onClick={() => removeUser(item.id)}>Archive</button></td></tr>)}</tbody></table></div>}</AdminListPanel>
        <AdminListPanel sectionId="admin-requests" eyebrow="Service requests" title={`Requests (${requests.length})`} empty="No requests match the search."><label className="dashboard-search">Search requests<input value={requestSearch} onChange={(event) => setRequestSearch(event.target.value)} placeholder="Description, category, or customer" /></label>{requests.length > 0 && <div className="table-wrap"><table className="admin-table"><thead><tr><th>Request</th><th>Customer</th><th>Bids</th><th>Posted</th><th>Action</th></tr></thead><tbody>{requests.map((item) => <tr key={item.id}><td><strong>{item.detail}</strong><small>{item.category}</small></td><td>{item.postedBy}</td><td>{item.bidCount}</td><td>{new Date(item.createdAt).toLocaleDateString()}</td><td><button className="quiet-button" type="button" onClick={() => removePost(item.id)}>Remove</button></td></tr>)}</tbody></table></div>}</AdminListPanel>
        <AdminListPanel sectionId="admin-tasks" eyebrow="Marketplace activity" title={`Tasks (${tasks.length})`} empty="No tasks match this status."><label className="dashboard-search">Status<select value={taskStatus} onChange={(event) => setTaskStatus(event.target.value)}><option value="all">All statuses</option><option value="pending">Pending</option><option value="accepted">Accepted</option><option value="scheduled">Scheduled</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option></select></label>{tasks.length > 0 && <div className="table-wrap"><table className="admin-table"><thead><tr><th>Request</th><th>Customer</th><th>Technician</th><th>Agreed price</th><th>Payment</th><th>Status</th><th>Change status</th></tr></thead><tbody>{tasks.map((item) => <tr key={item.id}><td><strong>{item.detail}</strong><small>{item.category}</small></td><td>{item.customerName}</td><td>{item.technicianName}</td><td>৳{item.agreedPrice ?? item.price}</td><td>{item.paymentStatus}{item.receiptNumber && <small>{item.receiptNumber}</small>}</td><td><span className="table-status">{item.status.replace('_', ' ')}</span></td><td><select className="admin-select" aria-label={`Change task status for ${item.detail}`} value={item.status} onChange={(event) => manageTask(item.id, event.target.value)}><option value="pending">Pending</option><option value="accepted">Accepted</option><option value="scheduled">Scheduled</option><option value="rejected">Rejected</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></td></tr>)}</tbody></table></div>}</AdminListPanel>
        <AdminListPanel sectionId="admin-technicians" eyebrow="Technician directory" title={`Technicians (${data.technicians.length})`} empty="No technicians found."><div className="table-wrap"><table className="admin-table"><thead><tr><th>Name</th><th>Skills</th><th>Area</th><th>Status</th><th>Review</th></tr></thead><tbody>{data.technicians.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.skills}</td><td>{item.address || '-'}</td><td><span className="table-status">{item.status}</span></td><td><select className="admin-select" aria-label={`Change application status for ${item.name}`} value={item.status} onChange={(event) => update(item.id, event.target.value)}><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></td></tr>)}</tbody></table></div></AdminListPanel>
      </>}
    </section>
  </DashboardLayout>
}

function App() {
  const path = usePath()
  const routePath = path.split('?')[0]
  const [user, setUser] = useState(getStoredUser)
  const userRole = user?.role
  const [postsState, setPostsState] = useState({ role: userRole, posts: [], loading: true, error: '' })
  const posts = postsState.role === userRole ? postsState.posts : []
  const postsLoading = postsState.role !== userRole || postsState.loading
  const postsError = postsState.role === userRole ? postsState.error : ''
  useEffect(() => { document.documentElement.dataset.theme = localStorage.getItem('helplagbe_theme') || 'dark' }, [])
  useEffect(() => {
    let active = true
    request('/posts')
      .then((data) => {
        if (!Array.isArray(data.items)) throw new Error('The service request list could not be read.')
        if (active) setPostsState({ role: userRole, posts: data.items, loading: false, error: '' })
      })
      .catch((error) => {
        if (active) {
          setPostsState({ role: userRole, posts: [], loading: false, error: error.message })
        }
      })
    return () => { active = false }
  }, [userRole])
  useEffect(() => { const sync = () => setUser(getStoredUser()); window.addEventListener('storage', sync); window.addEventListener('helplagbe-auth', sync); return () => { window.removeEventListener('storage', sync); window.removeEventListener('helplagbe-auth', sync) } }, [])
  if (routePath === '/login') return <AuthPage key={routePath} mode="login" />
  if (routePath === '/register') return <AuthPage key={routePath} mode="register" />
  if (routePath === '/register-technician') return <AuthPage key={routePath} mode="technician" />
  if (routePath === '/requests') return <RequestsPage posts={posts} user={user} />
  if (routePath === '/technicians') return <TechniciansPage user={user} />
  if (routePath === '/customer' || routePath === '/customer/new-request') return user?.role === 'customer' ? <CustomerDashboard key={path} user={user} /> : <AuthPage mode="login" />
  if (routePath === '/technician') return user?.role === 'technician' ? <TechnicianDashboard key={path} user={user} /> : <AuthPage mode="login" />
  if (routePath === '/admin') return user?.role === 'admin' ? <AdminDashboard key={path} user={user} /> : <AuthPage mode="login" />
  return <Home posts={posts} postsLoading={postsLoading} postsError={postsError} user={user} />
}

export default App
