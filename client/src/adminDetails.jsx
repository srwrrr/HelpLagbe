import { useCallback, useEffect, useRef, useState } from 'react'
import { KpiRow } from './analytics.jsx'

const money = (value) => `৳${Math.round(Number(value) || 0).toLocaleString('en-US')}`
const dateLabel = (value) => (value ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '-')
const ID_LABELS = { verified: 'Verified', unverified: 'Waiting for review', rejected: 'Rejected' }
const ACTION_LABELS = {
  id_verified: 'ID verified', id_rejected: 'ID rejected', id_document_viewed: 'ID document viewed', technician_suspended: 'Technician suspended',
  technician_approved: 'Technician approved', technician_rejected: 'Technician rejected', user_active: 'Account activated', user_suspended: 'Account suspended',
  user_archived: 'Account archived', user_restored: 'Account restored', marketplace_report_updated: 'Report updated',
}

function IdVerificationPanel({ technician, request, fetchBlob, onChanged, onViewed }) {
  const [imageUrl, setImageUrl] = useState('')
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const { idVerification } = technician

  // The document is private, so it is fetched with the admin's credentials and shown from memory only.
  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl) }, [imageUrl])

  const view = async () => {
    setBusy(true)
    setMessage('')
    try {
      const blob = await fetchBlob(`/admin/technicians/${technician.technicianId}/id-document`)
      setImageUrl(URL.createObjectURL(blob))
      onViewed?.()
    } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }
  const decide = async (decision) => {
    setBusy(true)
    setMessage('')
    try {
      const result = await request(`/admin/technicians/${technician.technicianId}/id-verification`, { method: 'PATCH', body: JSON.stringify({ decision, note }) })
      setMessage(result.message)
      setNote('')
      await onChanged()
    } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }

  return <section className="details-section"><h3>ID verification</h3>
    <p className="details-id-status"><span className={`dashboard-status status-id-${idVerification.status}`}>{ID_LABELS[idVerification.status] || idVerification.status}</span>
      {idVerification.status === 'verified' && <span className="muted-label"> by {idVerification.verifiedBy || 'an admin'} on {dateLabel(idVerification.verifiedAt)}</span>}
      {idVerification.status === 'rejected' && idVerification.note && <span className="muted-label"> - {idVerification.note}</span>}</p>
    {!idVerification.hasDocument ? <p className="muted-label">This technician has not uploaded an ID photo yet. National ID number on file: <strong>{technician.nationalId || '-'}</strong>.</p> : <>
      <p className="muted-label">Compare the photo with the national ID number on file: <strong>{technician.nationalId || '-'}</strong>. Opening the document is recorded in the audit log.</p>
      {idVerification.legacyPublicFile && <p className="muted-label details-warning">This older document is stored in the public uploads folder. Ask the technician to upload it again so it is kept privately.</p>}
      {imageUrl ? <a href={imageUrl} target="_blank" rel="noreferrer"><img className="details-id-image" src={imageUrl} alt="National ID document uploaded by the technician" /></a> : <button type="button" className="quiet-button" onClick={view} disabled={busy}>{busy ? 'Opening...' : 'View ID document'}</button>}
      <div className="details-review">
        <label>Reason (required to reject)<input value={note} maxLength="255" onChange={(event) => setNote(event.target.value)} placeholder="For example: the photo is blurry or the number does not match" /></label>
        <div className="details-actions"><button type="button" className="small-button" onClick={() => decide('verified')} disabled={busy || idVerification.status === 'verified'}>Verify ID</button><button type="button" className="quiet-button danger-button" onClick={() => decide('rejected')} disabled={busy || note.trim().length < 5}>Reject ID</button></div>
      </div></>}
    {message && <p className="form-message" role="status">{message}</p>}
  </section>
}

export function UserDetailsModal({ userId, request, fetchBlob, getAssetUrl, onClose, onChanged }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const dialogRef = useRef(null)

  const load = useCallback(async () => {
    try { setData(await request(`/admin/users/${userId}/details`)); setError('') } catch (failure) { setError(failure.message) }
  }, [request, userId])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogRef.current?.focus()
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      previousFocus?.focus?.()
    }
  }, [onClose])

  const refreshAll = async () => { await load(); await onChanged?.() }
  const user = data?.user
  const technician = data?.technician
  const customer = data?.customer

  return <div className="details-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className="details-modal viz-root" role="dialog" aria-modal="true" aria-labelledby="details-title" tabIndex={-1} ref={dialogRef}>
      <header className="details-header">
        <div className="details-identity">
          <span className="profile-avatar details-avatar">{user?.profileImage ? <img src={getAssetUrl(user.profileImage)} alt="" onError={(event) => { event.currentTarget.style.display = 'none' }} /> : (user?.name?.slice(0, 1) || '?')}</span>
          <div><h2 id="details-title">{user?.name || 'Loading...'}</h2>{data && <p className="muted-label"><span className="table-status">{data.role}</span> <span className="table-status">{user.accountStatus}</span> Joined {dateLabel(user.createdAt)}</p>}</div>
        </div>
        <button type="button" className="quiet-button" onClick={onClose} aria-label="Close details">Close</button>
      </header>
      {error && <div className="dashboard-error" role="alert"><p>{error}</p><button className="small-button" type="button" onClick={load}>Retry</button></div>}
      {!data && !error && <p className="viz-empty" role="status">Loading details...</p>}
      {data && <div className="details-body">
        <section className="details-section"><h3>Contact and account</h3>
          <dl className="details-list"><dt>Email</dt><dd>{user.email}</dd><dt>Phone</dt><dd>{user.phone || '-'}</dd><dt>Address</dt><dd>{user.address || '-'}</dd><dt>User ID</dt><dd>#{user.id}</dd>
            {technician && <><dt>National ID</dt><dd>{technician.nationalId || '-'}</dd><dt>Application</dt><dd>{technician.status}</dd><dt>Skills</dt><dd>{technician.skills || '-'}</dd><dt>Service areas</dt><dd>{technician.serviceAreas.length ? technician.serviceAreas.join(', ') : '-'}</dd><dt>Availability</dt><dd>{technician.availability || '-'}</dd></>}
          </dl>
        </section>

        {customer && <><KpiRow items={[
          { label: 'Requests', value: customer.kpis.requests, note: `${customer.kpis.openRequests} open` },
          { label: 'Jobs completed', value: customer.kpis.completedJobs, note: `${customer.kpis.cancelledJobs} cancelled` },
          { label: 'Paid', value: money(customer.kpis.paid), note: `${money(customer.kpis.outstanding)} not yet paid` },
          { label: 'Rating given', value: customer.kpis.averageRatingGiven === null ? '-' : `${customer.kpis.averageRatingGiven} / 5`, note: `${customer.kpis.reviewsGiven} reviews` },
          { label: 'Rated by technicians', value: customer.kpis.ratingFromTechnicians === null ? '-' : `${customer.kpis.ratingFromTechnicians} / 5`, note: `${customer.kpis.ratingsFromTechnicians} ratings` },
        ]} />
          <section className="details-section"><h3>Recent requests</h3>{customer.recentRequests.length ? <ul className="details-rows">{customer.recentRequests.map((item) => <li key={item.id}><div><strong>{item.detail}</strong><span className="muted-label">{item.category}{item.area ? ` · ${item.area}` : ''} · {dateLabel(item.createdAt)}{item.technicianName ? ` · ${item.technicianName}` : ''}</span></div><span className="table-status">{item.jobStatus ? item.jobStatus.replace('_', ' ') : item.closedAt ? 'closed' : 'open'}</span></li>)}</ul> : <p className="muted-label">No requests yet.</p>}</section></>}

        {technician && <><KpiRow items={[
          { label: 'Jobs completed', value: technician.kpis.completedJobs, note: `${technician.kpis.cancelledByThem} cancelled by them` },
          { label: 'Earned (paid)', value: money(technician.kpis.paid), note: `${money(technician.kpis.outstanding)} not yet paid` },
          { label: 'Rating', value: technician.kpis.averageRating === null ? '-' : `${technician.kpis.averageRating} / 5`, note: `${technician.kpis.reviews} reviews` },
          { label: 'Offers', value: technician.kpis.offersSent, note: `${technician.kpis.offersHired} hired · ${technician.kpis.offersDeclined} declined` },
          { label: 'Problem claims', value: technician.kpis.problemClaims, note: `${technician.kpis.openProblemClaims} open` },
        ]} />
          <IdVerificationPanel technician={technician} request={request} fetchBlob={fetchBlob} onChanged={refreshAll} onViewed={load} />
          <section className="details-section"><h3>Recent jobs and offers</h3>{technician.recentJobs.length ? <ul className="details-rows">{technician.recentJobs.map((item) => <li key={item.id}><div><strong>{item.detail}</strong><span className="muted-label">{item.category}{item.area ? ` · ${item.area}` : ''} · {dateLabel(item.date)} · Customer: {item.customerName} · {money(item.value)}</span></div><span className="table-status">{item.status.replace('_', ' ')}</span></li>)}</ul> : <p className="muted-label">No jobs or offers yet.</p>}</section></>}

        <section className="details-section"><h3>Safety</h3>
          <p className="muted-label">Blocking {data.blocks.blocking} {data.blocks.blocking === 1 ? 'person' : 'people'} &middot; blocked by {data.blocks.blockedBy}</p>
          {data.reports.length ? <ul className="details-rows">{data.reports.map((item) => <li key={item.id}><div><strong>{item.direction === 'filed' ? 'Filed a report' : 'Reported by someone'}: {item.category}</strong><span className="muted-label">{item.type} · {dateLabel(item.createdAt)}</span></div><span className={`dashboard-status status-${item.status}`}>{item.status}</span></li>)}</ul> : <p className="muted-label">No reports filed by or about this account.</p>}
        </section>

        <section className="details-section"><h3>Admin activity on this account</h3>{data.adminHistory.length ? <ul className="details-rows">{data.adminHistory.map((item, index) => <li key={index}><div><strong>{ACTION_LABELS[item.action] || item.action.replaceAll('_', ' ')}</strong><span className="muted-label">{item.details || ''}</span></div><span className="muted-label details-when">{item.adminName} &middot; {dateLabel(item.createdAt)}</span></li>)}</ul> : <p className="muted-label">Nothing recorded yet.</p>}</section>
      </div>}
    </div>
  </div>
}
