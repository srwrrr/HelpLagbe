# HelpLagbe Software Requirements Specification
## Implementation Addendum

**Status:** Current implementation supplement to the original SRS PDF  
**Updated:** November 2026

This addendum records user-facing requirements that clarify the delivered web application. Read it alongside the [original SRS](./Software%20Requirements%20Specification%20(SRS)%20for%20HelpLagbe.pdf). Where the original document describes planned capabilities that are not listed here as implemented, do not assume those capabilities are available in the current application.

## Current Product Scope

HelpLagbe is a responsive web-based home-services marketplace. Customers post service requests and compare technician bids. Technicians apply for approval before bidding. Administrators review technician applications and manage marketplace users and activity.

## Updated Functional Requirements

### Registration and account roles

- **FR-001 (clarified):** The registration page shall let a new user choose a Customer or Technician account.
- **FR-002:** Customer registration shall collect the common account details and create a customer account.
- **FR-003:** Technician registration shall collect technician-specific information, including national ID and skills, and submit an application for administrator approval.
- **FR-004:** The technician registration route shall open the registration form with Technician selected. Applicants shall also be able to select Customer instead.
- **FR-005:** A technician application shall remain pending until an administrator approves it. Only approved technicians may participate in bidding.
- **FR-006:** The sign-in experience shall continue to use the account role to route users to the appropriate workspace.
- **FR-006a:** Customers and technician applicants may provide a phone number during registration; it shall be optional and editable later from the profile. Email and password remain the sign-in credentials.

### Technician directory

- **FR-007:** The public technician directory shall list administrator-approved technicians only.
- **FR-008:** A technician listing shall show the technician's name, skills, service area, availability, number of completed jobs, customer rating, and typical first-offer response time.
- **FR-009:** The directory shall not expose private contact details. Communication between a customer and technician is available through the accepted-task messaging workflow.
- **FR-009a:** Customers shall be able to filter technicians by skill/name, service area, and availability, and sort by rating, completed work, or typical first-offer response time.
- **FR-010:** If the directory request fails, the interface shall show an error rather than presenting the failure as an empty directory.
- **FR-010a:** Public service-request listings shall identify the requester as anonymous. The requester's name may be shown only to an authenticated, administrator-approved technician.
- **FR-010b:** The public homepage shall display recent service requests using the paginated request list, while preserving the same requester-identity privacy rule.

### Homepage and navigation

- **FR-011:** The public homepage shall explain the customer service-request journey and provide clear actions to post a request and browse technicians.
- **FR-012:** The homepage shall provide a separate path for visitors who want to apply as technicians.
- **FR-013:** The homepage shall present the supported home-service categories and describe the basic request, bid comparison, and selection flow.
- **FR-014:** The shared site footer shall include contact links that open an email message or phone call.
- **FR-015:** Homepage, navigation, registration, and footer layouts shall remain usable on mobile-sized screens.

### Notifications

- **FR-016:** Signed-in users shall be able to open the existing notification menu from the site header and see their notifications and unread count.
- **FR-017:** The notification control shall use a recognizable bell icon, retain its unread-count badge, and communicate its expanded state to assistive technology.
- **FR-017a:** Notifications related to a task, bid, or message shall retain a safe task reference. Selecting one shall mark it read and navigate the signed-in participant to the related dashboard task or conversation; unrelated notifications shall remain readable without navigation.

### Customer and technician dashboards

- **FR-024:** Customer, technician, and administrator dashboards shall provide role-appropriate sidebar navigation to the main workspace sections and profile settings.
- **FR-025:** Customers, technicians, and administrators shall be able to edit their name, email, phone number, address, and profile photo from the dashboard.
- **FR-026:** Technicians shall also be able to edit their listed skills; profile changes shall update their technician directory information.
- **FR-027:** Profile changes shall be authenticated, validated, and rejected when the email is already used by another account. Profile photos shall accept JPG, PNG, or WebP images up to 5 MB, be stored as uploaded files, and be removable. A successful update shall refresh the signed-in user's displayed name, email, and avatar.
- **FR-028:** When a customer accepts a technician's bid, the customer workspace shall provide the technician's full name, skills, completed-task count, and overall customer rating and review count.
- **FR-028a:** Before accepting a pending bid, a customer shall be able to review the technician's profile, skills, service area, availability, completed-task count, up to five recent completed jobs, overall rating, and up to five recent customer reviews. This preview shall not expose the technician's private contact details.
- **FR-028b:** Each customer request shall capture its service address, with optional building and flat/unit details. The exact location shall be visible to the requesting customer and only to the selected technician after the bid is accepted; public listings and pending bidders shall not receive it.
- **FR-028c:** After a bid is accepted, the selected technician shall be able to view the job's service address and the customer's optional phone number in their task workspace; the customer shall be able to view the technician's optional phone number in the accepted technician profile. Neither side's phone number shall be shown to other bidders or in public listings.
- **FR-028d:** Customer request forms shall warn users not to put contact details or exact locations in public descriptions. Public request descriptions and pre-accept technician work history shall redact common email addresses, Bangladesh phone numbers, and street-address patterns; automated redaction is best-effort and does not replace user care.
- **FR-028e:** A customer may edit an open request, including its service location, until a technician has been accepted. Pending bidders shall be notified of changes and the edit shall be recorded in their task timelines. Customers shall be able to close an open request with a reason; this declines pending offers, notifies their technicians, and cannot be undone. Requests with accepted work must use the task cancellation workflow instead.
- **FR-028f:** A technician may withdraw their own pending offer with a reason. The customer shall be notified and the withdrawal shall be retained in the task timeline. Offers cannot be withdrawn after acceptance.
- **FR-028g:** Customers with older requests that have no service address shall be prompted to add the location before continuing to compare or accept offers.
- **FR-029:** After a technician completes a task, its customer shall be able to submit or update a one-to-five-star rating, select up to five suggested compliments, and optionally write a review of up to 500 characters.
- **FR-030:** A technician's overall customer rating shall be calculated from ratings submitted for completed tasks and displayed with the rating count. Review compliments shall be limited to the application's suggested list.
- **FR-031:** A saved technician profile photo shall appear in the approved technician directory and in the customer profile shown for an accepted task. Users without a photo shall retain an initial-based avatar.
- **FR-032:** Technician offers shall include a proposed appointment date and time. A customer acceptance confirms the initial proposal; a later reschedule shall record a reason, require the proposer and the other participant to confirm the new time, and prevent work from starting until both have confirmed.
- **FR-033:** Customers and technicians shall be able to cancel an accepted, scheduled, or in-progress task with a recorded reason. A task timeline shall show offer received, accepted, scheduled, in progress, and completed states, plus schedule changes and cancellation details.
- **FR-034:** Customers and technicians shall be able to report a task problem or dispute; signed-in users shall be able to report technician profiles and task messages. Administrators shall be able to review, resolve, or dismiss reports with an audit note.
- **FR-035:** The accepted bid amount shall be recorded as the agreed price. After task completion, each participant may confirm payment method and payment; a receipt reference shall be issued only after both confirm. This record does not process payments, hold funds, or represent independent proof of a bank transfer.
- **FR-035a:** New technician offers shall provide a scope note describing what the price includes, such as labor, parts, and call-out fees, and whether it may change. During an active task, either participant may propose a changed agreed price with an explanation; the other participant must approve it before it takes effect, and both proposal and decision shall appear in the task timeline.
- **FR-036:** Technician discovery shall support service-area and availability filters. Technician opportunities shall prioritize area matches; directory sorting shall support customer rating, typical first-offer response time, and completed jobs.
- **FR-037:** Technician application approval shall be described as an application review and shall not be represented as an independent identity guarantee.

### Administrative account deletion

- **FR-018:** An administrator removing an account shall first move it and its restorable marketplace history into Archived accounts.
- **FR-019:** Administrators shall be able to restore an archived account and its saved history if the original email is not already in use.
- **FR-020:** Administrators shall have a separate, explicitly confirmed permanent-delete action for archived accounts. Permanent deletion shall remove the archive snapshot and saved personal data and shall not be reversible through the application.
- **FR-021:** Permanent deletion shall retain a non-identifying administrative audit event and redact personal details in earlier archive/restore audit entries.
- **FR-022:** Permanent deletion shall be restricted to administrators; protected admin accounts cannot be archived through the user-removal workflow.
- **FR-023:** Archived accounts remain recoverable until an administrator restores or permanently deletes them; the application does not currently enforce an automatic expiry period.

## Scope and Requirement Status

The requirements above describe the current web application; they do not imply that every capability proposed in the original SRS has been delivered. In particular, the current application does not provide SMS one-time-password verification, social sign-in, a native technician mobile application, live technician location tracking, or integrated payment processing. The payment record is a bilateral self-confirmation only; HelpLagbe does not charge or hold funds.
