import { useEffect, useState } from 'react'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api'
const SERVER_URL = API_URL.replace(/\/api$/, '')

function getAssetUrl(path) {
  return path ? `${SERVER_URL}/${path.replace(/^\//, '')}` : ''
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
  useEffect(() => {
    if (!user) return
    const load = () => request('/notifications').then(setNotifications).catch(() => setNotifications([]))
    load()
    const timer = window.setInterval(load, 30000)
    return () => window.clearInterval(timer)
  }, [user])
  const unread = notifications.filter((notification) => !notification.readAt).length
  const markRead = async (notification) => {
    if (notification.readAt) return
    try {
      await request(`/notifications/${notification.id}/read`, { method: 'PATCH' })
      setNotifications((items) => items.map((item) => item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item))
    } catch {}
  }
  if (!user) return null
  return <div className="notification-center"><button className="notification-button" type="button" onClick={() => setOpen(!open)} aria-label="Notifications" title="Notifications"><span aria-hidden="true">!</span>{unread > 0 && <b>{unread > 9 ? '9+' : unread}</b>}</button>{open && <div className="notification-menu"><div className="notification-menu-heading"><strong>Notifications</strong><span>{unread ? `${unread} unread` : 'All caught up'}</span></div>{notifications.length ? notifications.map((notification) => <button className={`notification-item ${notification.readAt ? 'is-read' : ''}`} type="button" key={notification.id} onClick={() => markRead(notification)}><strong>{notification.title}</strong><span>{notification.message}</span><small>{new Date(notification.createdAt).toLocaleString()}</small></button>) : <p className="notification-empty">No notifications yet.</p>}</div>}</div>
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
  return <footer className="site-footer"><Brand /><span>Help anytime, anywhere.</span></footer>
}

function Shell({ children, user }) {
  return <main className="app-shell"><Header user={user} />{children}<Footer /></main>
}

function Home({ posts, user }) {
  return <Shell user={user}><section className="hero-section page-width"><div className="hero-copy"><p className="eyebrow">Reliable help, close to home</p><h1>Skilled hands for the jobs that keep life moving.</h1><p className="hero-text">Find trusted technicians for repairs, maintenance, and everyday home services. Post a request, compare bids, and get the work done.</p><div className="hero-actions"><button className="primary-button" type="button" onClick={() => go(user ? '/customer/new-request' : '/login')}>Post a service request</button><button className="text-button" type="button" onClick={() => go('/register-technician')}>Join as a technician <span>-&gt;</span></button></div><div className="trust-row"><span><strong>3 steps</strong> to get help</span><span><strong>Local</strong> technicians</span><span><strong>Clear</strong> pricing</span></div></div><div className="hero-visual"><div className="visual-note"><span className="note-dot"></span>Available today</div><div className="visual-card"><div className="card-header"><span>Popular request</span><span className="status-chip">Open</span></div><h2>AC not cooling properly</h2><p>Appliance repair &middot; Dhanmondi</p><div className="card-footer"><span className="avatar">NR</span><span>3 technicians interested</span><strong>from ৳500</strong></div></div><div className="visual-sun"></div><div className="visual-line line-one"></div><div className="visual-line line-two"></div></div></section><section className="services-section page-width"><div className="section-heading"><div><p className="eyebrow">What can we help with?</p><h2>One place for practical help.</h2></div><button className="outline-button" type="button" onClick={() => go('/requests')}>View all requests</button></div><div className="service-grid"><ServiceCard tone="warm" icon="AC" title="Appliance repair" text="AC, washing machines, refrigerators, and more." /><ServiceCard tone="green" icon="PL" title="Plumbing" text="Leaks, fixtures, pipes, and urgent repairs." /><ServiceCard tone="blue" icon="EL" title="Electrical work" text="Safe installation and everyday electrical fixes." /><ServiceCard tone="lilac" icon="HM" title="Home maintenance" text="Small jobs that make a big difference." /></div></section><section className="steps-section page-width"><div className="section-heading"><div><p className="eyebrow">How HelpLagbe works</p><h2>From “I need help” to “all sorted.”</h2></div></div><div className="steps-grid"><Step number="01" title="Describe the job" text="Tell us what needs fixing and add a photo if it helps." /><Step number="02" title="Compare local bids" text="Technicians respond with their price and availability." /><Step number="03" title="Choose your helper" text="Accept the bid that feels right and track the task." /></div></section><RequestPreview posts={posts} /></Shell>
}

function ServiceCard({ tone, icon, title, text }) { return <article className={`service-card ${tone}`}><span className="service-icon">{icon}</span><h3>{title}</h3><p>{text}</p><span className="service-arrow">-&gt;</span></article> }
function Step({ number, title, text }) { return <div className="step"><span className="step-number">{number}</span><h3>{title}</h3><p>{text}</p></div> }

function RequestPreview({ posts }) {
  return <section className="request-section page-width"><div className="section-heading"><div><p className="eyebrow">Live service requests</p><h2>See what people need today.</h2></div><button className="outline-button" type="button" onClick={() => go('/requests')}>Browse marketplace</button></div>{posts.length ? <div className="request-grid">{posts.slice(0, 6).map((post) => <RequestCard key={post.id} post={post} />)}</div> : <EmptyState text="No live requests yet." />}</section>
}

function RequestCard({ post, action }) {
  return <article className="request-card">{post.image && <img className="request-image" src={getAssetUrl(post.image)} alt="Attached request" />}<span className="request-category">{post.category}</span><h3>{post.detail}</h3><p>Posted {post.createdAt ? new Date(post.createdAt).toLocaleDateString() : 'recently'}</p>{action}</article>
}
function EmptyState({ text }) { return <div className="empty-state"><span className="empty-icon">-</span><p>{text}</p></div> }
function LoadingState({ text = 'Loading...' }) { return <div className="loading-state" role="status"><span className="loading-spinner" aria-hidden="true"></span><p>{text}</p></div> }

function ReviewPanel() {
  const [posts, setPosts] = useState([])
  const [refresh, setRefresh] = useState(0)
  useEffect(() => { request('/customer/posts').then(setPosts).catch(() => setPosts([])) }, [refresh])
  const completed = posts.find((post) => post.taskId && post.status === 'completed')
  const [rating, setRating] = useState(completed?.reviewRating || 5)
  const [review, setReview] = useState(completed?.reviewText || '')
  const [message, setMessage] = useState('')
  if (!completed) return null
  const submit = async (event) => {
    event.preventDefault()
    setMessage('Saving...')
    try {
      await request(`/tasks/${completed.taskId}/review`, { method: 'POST', body: JSON.stringify({ rating, review }) })
      setMessage('Review saved.')
      setRefresh((value) => value + 1)
    } catch (error) { setMessage(error.message) }
  }
  return <div className="panel review-panel"><div className="panel-heading"><div><p className="eyebrow">Completed work</p><h2>How was the service?</h2></div><span className="verified-label">Private review</span></div><p className="review-context">Your review helps other customers choose trusted technicians.</p><form className="review-form" onSubmit={submit}><label>Rating<select value={rating} onChange={(event) => setRating(Number(event.target.value))}><option value="5">5 - Excellent</option><option value="4">4 - Good</option><option value="3">3 - Okay</option><option value="2">2 - Needs improvement</option><option value="1">1 - Poor</option></select></label><label>Review<textarea rows="3" maxLength="500" value={review} onChange={(event) => setReview(event.target.value)} placeholder="Share a short review (optional)" /></label><button className="primary-button" type="submit">Save review</button>{message && <p className="form-message">{message}</p>}</form></div>
}

function BidEditor() {
  const [tasks, setTasks] = useState([])
  const [prices, setPrices] = useState({})
  const [message, setMessage] = useState('')
  const load = () => request('/technician/tasks').then(setTasks).catch(() => setTasks([]))
  useEffect(() => { load() }, [])
  const update = async (taskId) => {
    try { await request(`/technician/tasks/${taskId}/bid`, { method: 'PATCH', body: JSON.stringify({ price: prices[taskId] }) }); setMessage('Bid updated.'); load() } catch (error) { setMessage(error.message) }
  }
  const pending = tasks.filter((task) => task.status === 'pending')
  if (!pending.length) return null
  return <section className="page-width bid-editor-section"><div className="panel"><div className="panel-heading"><div><p className="eyebrow">Your pending offers</p><h2>Review your bids</h2></div><span className="count-badge">{pending.length}</span></div><div className="bid-editor-list">{pending.map((task) => <div className="bid-editor-row" key={task.id}><div><strong>{task.detail}</strong><span>Current offer: {task.price}</span></div><input type="number" min="0" value={prices[task.id] ?? task.price} onChange={(event) => setPrices({ ...prices, [task.id]: event.target.value })} /><button className="small-button" type="button" onClick={() => update(task.id)}>Update bid</button></div>)}</div>{message && <p className="form-message">{message}</p>}</div></section>
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
  return <section className="page-width archive-section"><div className="panel"><div className="panel-heading"><div><p className="eyebrow">Data retention</p><h2>Archived accounts</h2></div><span className="count-badge">{archives.length}</span></div>{loading ? <LoadingState text="Loading archived accounts..." /> : archives.length ? <div className="table-wrap"><table className="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Archived</th><th>Reason</th><th>Action</th></tr></thead><tbody>{archives.map((archive) => <tr key={archive.id}><td>{archive.username}</td><td>{archive.email}</td><td><span className="table-status">{archive.role}</span></td><td>{new Date(archive.archivedAt).toLocaleString()}</td><td>{archive.reason}</td><td><button className="quiet-button" type="button" onClick={() => restore(archive.id)}>Restore</button></td></tr>)}</tbody></table></div> : <EmptyState text="No accounts have been archived." />}{message && <p className="form-message">{message}</p>}</div></section>
}

function MessagesPanel() {
  const [conversations, setConversations] = useState([])
  const [selectedTask, setSelectedTask] = useState(null)
  const [messages, setMessages] = useState([])
  const [body, setBody] = useState('')
  const [message, setMessage] = useState('')
  const loadConversations = () => request('/messages').then((items) => { setConversations(items); setSelectedTask((current) => current || items[0]?.taskId || null) }).catch(() => setConversations([]))
  useEffect(() => { loadConversations() }, [])
  useEffect(() => { if (selectedTask) request(`/messages/${selectedTask}`).then(setMessages).catch(() => setMessages([])) }, [selectedTask])
  const send = async (event) => {
    event.preventDefault()
    if (!selectedTask || !body.trim()) return
    try { await request(`/messages/${selectedTask}`, { method: 'POST', body: JSON.stringify({ body }) }); setBody(''); setMessage('Message sent.'); const items = await request(`/messages/${selectedTask}`); setMessages(items) } catch (error) { setMessage(error.message) }
  }
  if (!conversations.length) return null
  return <section className="page-width messages-section"><div className="panel"><div className="panel-heading"><div><p className="eyebrow">Private communication</p><h2>Messages</h2></div><span className="verified-label">Task-only</span></div><div className="messages-layout"><div className="conversation-list">{conversations.map((conversation) => <button className={selectedTask === conversation.taskId ? 'conversation-button active' : 'conversation-button'} type="button" key={conversation.taskId} onClick={() => setSelectedTask(conversation.taskId)}><strong>{conversation.detail}</strong><span>{conversation.status.replace('_', ' ')}</span></button>)}</div><div className="message-thread">{messages.length ? messages.map((item) => <div className="message-bubble" key={item.id}><strong>{item.senderName}</strong><p>{item.body}</p><small>{new Date(item.createdAt).toLocaleString()}</small></div>) : <p className="muted-label">Start the conversation for this accepted task.</p>}<form className="message-form" onSubmit={send}><input value={body} maxLength="1000" onChange={(event) => setBody(event.target.value)} placeholder="Write a message..." /><button className="small-button" type="submit">Send</button></form>{message && <p className="form-message">{message}</p>}</div></div></div></section>
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
  useEffect(() => { request('/technicians').then(setTechnicians).catch(() => setTechnicians([])).finally(() => setLoading(false)) }, [])
  return <Shell user={user}><section className="page-heading page-width"><p className="eyebrow">Verified professionals</p><h1>Find a technician you can trust.</h1><p>Browse admin-approved technicians by their skills, ratings, and completed work. Contact details stay private until a job is accepted.</p></section><section className="request-section page-width">{loading ? <LoadingState text="Loading approved technicians..." /> : <><div className="technician-grid">{technicians.map((technician) => <article className="technician-card" key={technician.id}><div className="technician-avatar">{technician.name?.slice(0, 1)}</div><div><div className="technician-card-heading"><h2>{technician.name}</h2><span className="verified-label">Verified</span></div><p>{technician.skills}</p><div className="technician-stats"><span className="completed-count">{technician.completedJobs} completed {Number(technician.completedJobs) === 1 ? 'job' : 'jobs'}</span><span>{technician.averageRating ? `${technician.averageRating}/5 rating` : 'New to reviews'}</span>{technician.reviewCount > 0 && <span>{technician.reviewCount} {Number(technician.reviewCount) === 1 ? 'review' : 'reviews'}</span>}</div></div></article>)}</div>{!technicians.length && <EmptyState text="No approved technicians are available yet." />}</>}</section></Shell>
}

function AuthPage({ mode }) {
  const isTechnician = mode === 'technician'
  const isRegister = mode !== 'login'
  const [form, setForm] = useState({ email: '', password: '', username: '', nationalId: '', skills: '', address: '', phone: '' })
  const [message, setMessage] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const submit = async (event) => {
    event.preventDefault()
    setMessage('Working...')
    try {
      const endpoint = isTechnician ? '/auth/register-technician' : `/auth/${mode}`
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
  return <Shell><section className="auth-page"><div className="auth-panel"><p className="eyebrow">HelpLagbe account</p><h1>{mode === 'login' ? 'Welcome back.' : isTechnician ? 'Put your skills to work.' : 'Start getting help.'}</h1><p className="auth-intro">{mode === 'login' ? 'Sign in to continue to your workspace.' : isTechnician ? 'Apply to join trusted technicians on HelpLagbe.' : 'Create an account and get your next job moving.'}</p><form onSubmit={submit}>{isRegister && <label>Name<input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required /></label>}<label>Email<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></label><label>Password<div className="password-input-wrap"><input type={showPassword ? 'text' : 'password'} minLength="8" maxLength="72" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required /><button className="password-toggle" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? 'Hide' : 'Show'}</button></div></label>{isTechnician && <><label>National ID<input value={form.nationalId} onChange={(event) => setForm({ ...form, nationalId: event.target.value })} required /></label><label>Skills<textarea rows="3" value={form.skills} onChange={(event) => setForm({ ...form, skills: event.target.value })} required /></label><label>Address<input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></label></>}<button className="primary-button auth-submit" type="submit">{mode === 'login' ? 'Log in' : isTechnician ? 'Submit application' : 'Create account'}</button></form>{message && <p className="form-message">{message}</p>}<div className="auth-links">{mode === 'login' ? <><button type="button" onClick={() => go('/register')}>Need an account? Register</button><button type="button" onClick={() => go('/register-technician')}>Join as a technician</button></> : <button type="button" onClick={() => go('/login')}>Already registered? Log in</button>}</div></div><div className="auth-side"><span className="side-mark">H</span><h2>Help that fits real life.</h2><p>One trusted place for customers, technicians, and the people who keep homes running.</p></div></section></Shell>
}

function DashboardLayout({ user, eyebrow, title, description, children }) {
  return <Shell user={user}><section className="dashboard-heading page-width"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div><div className="profile-chip"><span className="profile-avatar">{user.name?.slice(0, 1)}</span><span><strong>{user.name}</strong><small>{user.email}</small></span></div></section>{user.role === 'customer' && <section className="page-width review-section"><ReviewPanel /></section>}{user.role === 'technician' && <BidEditor />}{user.role === 'admin' && <><AdminTools /><ArchivedUsersPanel /></>}{user.role !== 'admin' && <MessagesPanel />}{children}</Shell>
}

function CustomerDashboard({ user }) {
  const [posts, setPosts] = useState([])
  const [form, setForm] = useState({ detail: '', category: 'Appliance', subCategory: '' })
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
    active: posts.filter((post) => ['accepted', 'in_progress'].includes(post.status)).length,
    completed: posts.filter((post) => post.status === 'completed').length,
  }
  const visiblePosts = groupedPosts.filter((post) => {
    const terms = `${post.detail} ${post.category} ${post.technicianName || ''}`.toLowerCase()
    const matchesSearch = terms.includes(search.trim().toLowerCase())
    const matchesFilter = filter === 'all'
      || (filter === 'attention' && posts.some((bid) => bid.id === post.id && bid.status === 'pending'))
      || (filter === 'active' && posts.some((bid) => bid.id === post.id && ['accepted', 'in_progress'].includes(bid.status)))
      || (filter === 'completed' && posts.some((bid) => bid.id === post.id && bid.status === 'completed'))
    return matchesSearch && matchesFilter
  })

  const submit = async (event) => {
    event.preventDefault()
    setMessage('Posting request...')
    try {
      await request('/posts', { method: 'POST', body: JSON.stringify({ ...form, imageData }) })
      setForm({ detail: '', category: 'Appliance', subCategory: '' })
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
    try {
      await request(`/tasks/${taskId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })
      setMessage(status === 'accepted' ? 'Bid accepted.' : 'Bid declined.')
      await load()
    } catch (error) {
      setMessage(error.message)
    }
  }

  return <DashboardLayout user={user} eyebrow="Customer workspace" title="Your service requests." description="Track offers, active work, and completed jobs in one place.">
    <section className="customer-dashboard page-width">
      <div className="dashboard-summary" aria-label="Request summary">
        <div><strong>{counts.requests}</strong><span>Requests</span></div>
        <div><strong>{counts.attention}</strong><span>Bids to review</span></div>
        <div><strong>{counts.active}</strong><span>Active jobs</span></div>
        <div><strong>{counts.completed}</strong><span>Completed</span></div>
      </div>
      <div className="dashboard-toolbar">
        <div className="dashboard-filter-group" role="group" aria-label="Filter requests">
          {[['all', 'All'], ['attention', 'Needs attention'], ['active', 'Active'], ['completed', 'Completed']].map(([value, label]) => <button key={value} type="button" className={filter === value ? 'filter-chip is-active' : 'filter-chip'} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
        </div>
        <label className="dashboard-search">Search requests<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Description or category" /></label>
        <button className="primary-button" type="button" onClick={() => { setShowForm((visible) => !visible); setMessage('') }}>{showForm ? 'Close form' : 'New request'}</button>
      </div>
      {showForm && <div className="panel request-create-panel"><div className="panel-heading"><div><p className="eyebrow">New request</p><h2>What needs doing?</h2></div></div><form className="request-form" onSubmit={submit}><label>Describe the job<textarea rows="4" maxLength="2000" value={form.detail} onChange={(event) => setForm({ ...form, detail: event.target.value })} required placeholder="Tell technicians what needs fixing..." /></label><div className="form-row"><label>Category<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option>Appliance</option><option>Plumbing</option><option>Electrical</option><option>Home maintenance</option><option>Computer</option></select></label><label>Subcategory<input maxLength="100" value={form.subCategory} onChange={(event) => setForm({ ...form, subCategory: event.target.value })} placeholder="Optional" /></label></div><label className="file-field">Photo (optional)<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 5 * 1024 * 1024) { setMessage('Image must be 5MB or smaller.'); return } const reader = new FileReader(); reader.onload = () => { setImageData(reader.result); setImageName(file.name) }; reader.readAsDataURL(file) }} /></label>{imageName && <span className="file-name">Attached: {imageName}</span>}<button className="primary-button" type="submit">Post request</button></form></div>}
      {message && <p className="form-message" role="status">{message}</p>}
      {loading ? <LoadingState text="Loading your requests..." /> : loadError ? <div className="dashboard-error" role="alert"><p>{loadError}</p><button className="small-button" type="button" onClick={load}>Retry</button></div> : visiblePosts.length ? <div className="customer-request-list">{visiblePosts.map((post) => {
        const bids = posts.filter((bid) => bid.id === post.id && bid.taskId)
        const hasAttention = bids.some((bid) => bid.status === 'pending')
        const state = bids.find((bid) => ['accepted', 'in_progress'].includes(bid.status))?.status || (bids.some((bid) => bid.status === 'completed') ? 'completed' : 'waiting')
        return <article className="customer-request-item" key={post.id}>
          <div className="customer-request-heading"><div>{post.image && <img className="activity-image" src={getAssetUrl(post.image)} alt="Attached request" />}<span className="request-category">{post.category}</span><h2>{post.detail}</h2><span className="muted-label">{bids.length} {bids.length === 1 ? 'bid' : 'bids'}</span></div><span className={`dashboard-status status-${state}`}>{hasAttention ? 'Review bids' : state === 'waiting' ? 'Waiting for bids' : state.replace('_', ' ')}</span></div>
          {bids.length > 0 && <div className="customer-bid-list">{bids.map((bid) => <div className="customer-bid-row" key={bid.taskId}><div><strong>{bid.technicianName || 'Verified technician'}</strong><span>{bid.technicianSkills || 'Approved technician'}{bid.technicianStatus ? ` · ${bid.technicianStatus}` : ''}</span></div><strong className="bid-price">৳{bid.price}</strong>{bid.status === 'pending' ? <div className="bid-actions"><button className="small-button" type="button" onClick={() => updateBid(bid.taskId, 'accepted')}>Accept</button><button className="quiet-button" type="button" onClick={() => updateBid(bid.taskId, 'rejected')}>Decline</button></div> : <span className={`table-status status-${bid.status}`}>{bid.status.replace('_', ' ')}</span>}</div>)}</div>}
        </article>
      })}</div> : <EmptyState text={posts.length ? 'No requests match your filters.' : 'Your requests will appear here after you post one.'} />}
    </section>
  </DashboardLayout>
}

function TechnicianDashboard({ user }) {
  const [requests, setRequests] = useState([])
  const [tasks, setTasks] = useState([])
  const [prices, setPrices] = useState({})
  const [message, setMessage] = useState('')
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
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
    try { await request('/tasks/bid', { method: 'POST', body: JSON.stringify({ postId, price }) }); setMessage('Bid placed successfully.'); await load() } catch (error) { setMessage(error.message) }
  }
  const updateTask = async (taskId, status) => { try { await request(`/technician/tasks/${taskId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); setMessage(status === 'completed' ? 'Job marked complete.' : 'Job started.'); await load() } catch (error) { setMessage(error.message) } }
  const categories = ['all', ...new Set(requests.map((item) => item.category).filter(Boolean))]
  const visibleRequests = requests.filter((item) => `${item.detail} ${item.category} ${item.subCategory || ''}`.toLowerCase().includes(query.trim().toLowerCase()) && (category === 'all' || item.category === category))
  const pendingBids = tasks.filter((task) => task.status === 'pending')
  const activeTasks = tasks.filter((task) => ['accepted', 'in_progress'].includes(task.status))
  const completedTasks = tasks.filter((task) => ['completed', 'rejected', 'cancelled'].includes(task.status))
  return <DashboardLayout user={user} eyebrow="Technician workspace" title="Your work, clearly queued." description="Find suitable requests, manage offers, and move accepted jobs forward.">
    <section className="technician-dashboard page-width">
      <div className="dashboard-summary" aria-label="Work summary"><div><strong>{requests.length}</strong><span>Open requests</span></div><div><strong>{pendingBids.length}</strong><span>Pending bids</span></div><div><strong>{activeTasks.length}</strong><span>Active jobs</span></div><div><strong>{tasks.filter((task) => task.status === 'completed').length}</strong><span>Completed</span></div></div>
      {message && <p className="form-message" role="status">{message}</p>}
      {loading ? <LoadingState text="Loading your work..." /> : loadError ? <div className="dashboard-error" role="alert"><p>{loadError}</p><button className="small-button" type="button" onClick={load}>Retry</button></div> : <>
        <section className="panel"><div className="panel-heading"><div><p className="eyebrow">Opportunities</p><h2>Requests waiting for an offer</h2></div><span className="count-badge">{visibleRequests.length}</span></div><div className="dashboard-toolbar"><label className="dashboard-search">Search requests<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Description or category" /></label><label className="dashboard-search">Category<select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item} value={item}>{item === 'all' ? 'All categories' : item}</option>)}</select></label></div>{visibleRequests.length ? <div className="request-grid compact-grid">{visibleRequests.map((item) => <article className="request-card" key={item.id}><span className="request-category">{item.category}</span><h3>{item.detail}</h3><p>{item.subCategory || 'Service request'} · Posted {new Date(item.createdAt).toLocaleDateString()}</p><div className="bid-row"><label className="visually-hidden" htmlFor={`bid-price-${item.id}`}>Your bid amount</label><input id={`bid-price-${item.id}`} type="number" min="0.01" step="0.01" placeholder="Your price" value={prices[item.id] || ''} onChange={(event) => setPrices({ ...prices, [item.id]: event.target.value })} /><button className="small-button" type="button" onClick={() => bid(item.id)}>Place bid</button></div></article>)}</div> : <EmptyState text={requests.length ? 'No requests match those filters.' : 'There are no open requests right now.'} />}</section>
        <section className="panel"><div className="panel-heading"><div><p className="eyebrow">Your offers</p><h2>Pending bids</h2></div><span className="count-badge">{pendingBids.length}</span></div>{pendingBids.length ? <div className="bid-editor-list">{pendingBids.map((task) => <div className="bid-editor-row" key={task.id}><div><strong>{task.detail}</strong><span>Current offer: ৳{task.price}</span></div><input type="number" min="0.01" step="0.01" aria-label={`Updated offer for ${task.detail}`} value={prices[`task-${task.id}`] ?? task.price} onChange={(event) => setPrices({ ...prices, [`task-${task.id}`]: event.target.value })} /><button className="small-button" type="button" onClick={async () => { try { await request(`/technician/tasks/${task.id}/bid`, { method: 'PATCH', body: JSON.stringify({ price: prices[`task-${task.id}`] ?? task.price }) }); setMessage('Bid updated.'); await load() } catch (error) { setMessage(error.message) } }}>Update bid</button></div>)}</div> : <EmptyState text="Bids you place will appear here until the customer decides." />}</section>
        <section className="panel"><div className="panel-heading"><div><p className="eyebrow">Task lifecycle</p><h2>Active jobs</h2></div><span className="count-badge">{activeTasks.length}</span></div>{activeTasks.length ? <div className="activity-list">{activeTasks.map((task) => <article className="activity-item" key={task.id}><div><span className="request-category">{task.category}</span><h3>{task.detail}</h3><span className="muted-label">Agreed bid: ৳{task.price}</span></div><div className="activity-meta"><strong className={`status-${task.status}`}>{task.status.replace('_', ' ')}</strong>{task.status === 'accepted' && <button className="small-button" type="button" onClick={() => updateTask(task.id, 'in_progress')}>Start job</button>}{task.status === 'in_progress' && <button className="small-button" type="button" onClick={() => updateTask(task.id, 'completed')}>Mark complete</button>}</div></article>)}</div> : <EmptyState text="Accepted work will appear here." />}</section>
        {completedTasks.length > 0 && <details className="panel history-panel"><summary>Completed and closed work ({completedTasks.length})</summary><div className="activity-list">{completedTasks.map((task) => <article className="activity-item" key={task.id}><div><span className="request-category">{task.category}</span><h3>{task.detail}</h3><span className="muted-label">Bid: ৳{task.price}</span></div><span className={`dashboard-status status-${task.status}`}>{task.status.replace('_', ' ')}</span></article>)}</div></details>}
      </>}
    </section>
  </DashboardLayout>
}

function AdminListPanel({ title, eyebrow, children, empty }) {
  return <div className="panel admin-list-panel"><div className="panel-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div></div>{children || <EmptyState text={empty} />}</div>
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
  const removeUser = async (id) => { if (!window.confirm('Archive and remove this user and related marketplace data?')) return; try { await request(`/admin/users/${id}`, { method: 'DELETE' }); setMessage('User archived and removed.'); await load() } catch (error) { setMessage(error.message) } }
  const users = (data?.users || []).filter((item) => item.role !== 'admin' && (userRole === 'all' || item.role === userRole) && `${item.name} ${item.email}`.toLowerCase().includes(userSearch.trim().toLowerCase()))
  const requests = (data?.posts || []).filter((item) => `${item.detail} ${item.category} ${item.postedBy}`.toLowerCase().includes(requestSearch.trim().toLowerCase()))
  const tasks = (data?.tasks || []).filter((item) => taskStatus === 'all' || item.status === taskStatus)
  return <DashboardLayout user={user} eyebrow="Admin workspace" title="Keep the marketplace healthy." description="Review exceptions, oversee users, and keep requests moving.">
    <section className="admin-page page-width">
      {message && <p className="form-message" role="status">{message}</p>}
      {loading ? <LoadingState text="Loading marketplace overview..." /> : loadError ? <div className="dashboard-error" role="alert"><p>{loadError}</p><button className="small-button" type="button" onClick={load}>Retry</button></div> : data && <>
        <div className="dashboard-summary admin-summary">{Object.entries(data.counts).map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label.replace(/([A-Z])/g, ' $1')}</span></div>)}</div>
        <AdminListPanel eyebrow="Needs attention" title={`Technician applications (${data.pendingTechnicians.length})`} empty="No pending technician applications.">{data.pendingTechnicians.length > 0 && <div className="activity-list">{data.pendingTechnicians.map((technician) => <article className="activity-item" key={technician.id}><div><span className="request-category">Application · {technician.address || 'Area not provided'}</span><h3>{technician.name}</h3><p>{technician.skills}</p></div><div className="bid-actions"><button className="small-button" type="button" onClick={() => update(technician.id, 'approved')}>Approve</button><button className="quiet-button" type="button" onClick={() => update(technician.id, 'rejected')}>Reject</button></div></article>)}</div>}</AdminListPanel>
        <AdminListPanel eyebrow="Directory" title={`Users (${users.length})`} empty="No users match those filters."><div className="dashboard-toolbar"><label className="dashboard-search">Search users<input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Name or email" /></label><label className="dashboard-search">Role<select value={userRole} onChange={(event) => setUserRole(event.target.value)}><option value="all">All roles</option><option value="customer">Customers</option><option value="technician">Technicians</option></select></label></div>{users.length > 0 && <div className="table-wrap"><table className="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th>Action</th></tr></thead><tbody>{users.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.email}</td><td><span className="table-status">{item.role}</span></td><td>{new Date(item.createdAt).toLocaleDateString()}</td><td><button className="quiet-button" type="button" onClick={() => removeUser(item.id)}>Archive</button></td></tr>)}</tbody></table></div>}</AdminListPanel>
        <AdminListPanel eyebrow="Service requests" title={`Requests (${requests.length})`} empty="No requests match the search."><label className="dashboard-search">Search requests<input value={requestSearch} onChange={(event) => setRequestSearch(event.target.value)} placeholder="Description, category, or customer" /></label>{requests.length > 0 && <div className="table-wrap"><table className="admin-table"><thead><tr><th>Request</th><th>Customer</th><th>Bids</th><th>Posted</th><th>Action</th></tr></thead><tbody>{requests.map((item) => <tr key={item.id}><td><strong>{item.detail}</strong><small>{item.category}</small></td><td>{item.postedBy}</td><td>{item.bidCount}</td><td>{new Date(item.createdAt).toLocaleDateString()}</td><td><button className="quiet-button" type="button" onClick={() => removePost(item.id)}>Remove</button></td></tr>)}</tbody></table></div>}</AdminListPanel>
        <AdminListPanel eyebrow="Marketplace activity" title={`Tasks (${tasks.length})`} empty="No tasks match this status."><label className="dashboard-search">Status<select value={taskStatus} onChange={(event) => setTaskStatus(event.target.value)}><option value="all">All statuses</option><option value="pending">Pending</option><option value="accepted">Accepted</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option></select></label>{tasks.length > 0 && <div className="table-wrap"><table className="admin-table"><thead><tr><th>Request</th><th>Customer</th><th>Technician</th><th>Price</th><th>Status</th><th>Change status</th></tr></thead><tbody>{tasks.map((item) => <tr key={item.id}><td><strong>{item.detail}</strong><small>{item.category}</small></td><td>{item.customerName}</td><td>{item.technicianName}</td><td>৳{item.price}</td><td><span className="table-status">{item.status.replace('_', ' ')}</span></td><td><select className="admin-select" aria-label={`Change task status for ${item.detail}`} value={item.status} onChange={(event) => manageTask(item.id, event.target.value)}><option value="pending">Pending</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></td></tr>)}</tbody></table></div>}</AdminListPanel>
        <AdminListPanel eyebrow="Technician directory" title={`Technicians (${data.technicians.length})`} empty="No technicians found."><div className="table-wrap"><table className="admin-table"><thead><tr><th>Name</th><th>Skills</th><th>Area</th><th>Status</th><th>Review</th></tr></thead><tbody>{data.technicians.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.skills}</td><td>{item.address || '-'}</td><td><span className="table-status">{item.status}</span></td><td><select className="admin-select" aria-label={`Change application status for ${item.name}`} value={item.status} onChange={(event) => update(item.id, event.target.value)}><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></td></tr>)}</tbody></table></div></AdminListPanel>
      </>}
    </section>
  </DashboardLayout>
}

function App() {
  const path = usePath()
  const [user, setUser] = useState(getStoredUser)
  const [posts, setPosts] = useState([])
  useEffect(() => { document.documentElement.dataset.theme = localStorage.getItem('helplagbe_theme') || 'dark' }, [])
  useEffect(() => { request('/posts').then(setPosts).catch(() => setPosts([])) }, [])
  useEffect(() => { const sync = () => setUser(getStoredUser()); window.addEventListener('storage', sync); window.addEventListener('helplagbe-auth', sync); return () => { window.removeEventListener('storage', sync); window.removeEventListener('helplagbe-auth', sync) } }, [])
  if (path === '/login') return <AuthPage mode="login" />
  if (path === '/register') return <AuthPage mode="register" />
  if (path === '/register-technician') return <AuthPage mode="technician" />
  if (path === '/requests') return <RequestsPage posts={posts} user={user} />
  if (path === '/technicians') return <TechniciansPage user={user} />
  if (path === '/customer' || path === '/customer/new-request') return user?.role === 'customer' ? <CustomerDashboard user={user} /> : <AuthPage mode="login" />
  if (path === '/technician') return user?.role === 'technician' ? <TechnicianDashboard user={user} /> : <AuthPage mode="login" />
  if (path === '/admin') return user?.role === 'admin' ? <AdminDashboard user={user} /> : <AuthPage mode="login" />
  return <Home posts={posts} user={user} />
}

export default App
