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

### Technician directory

- **FR-007:** The public technician directory shall list administrator-approved technicians only.
- **FR-008:** A technician listing shall show the technician's name, skills, number of completed jobs, and available customer rating information.
- **FR-009:** The directory shall not expose private contact details. Communication between a customer and technician is available through the accepted-task messaging workflow.
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

### Customer and technician dashboards

- **FR-024:** Customer and technician dashboards shall provide role-appropriate sidebar navigation to the main workspace sections and profile settings.
- **FR-025:** Customers and technicians shall be able to edit their name, email, phone number, and address from the dashboard.
- **FR-026:** Technicians shall also be able to edit their listed skills; profile changes shall update their technician directory information.
- **FR-027:** Profile changes shall be authenticated, validated, and rejected when the email is already used by another account. A successful update shall refresh the signed-in user's displayed name and email.

### Administrative account deletion

- **FR-018:** An administrator removing an account shall first move it and its restorable marketplace history into Archived accounts.
- **FR-019:** Administrators shall be able to restore an archived account and its saved history if the original email is not already in use.
- **FR-020:** Administrators shall have a separate, explicitly confirmed permanent-delete action for archived accounts. Permanent deletion shall remove the archive snapshot and saved personal data and shall not be reversible through the application.
- **FR-021:** Permanent deletion shall retain a non-identifying administrative audit event and redact personal details in earlier archive/restore audit entries.
- **FR-022:** Permanent deletion shall be restricted to administrators; protected admin accounts cannot be archived through the user-removal workflow.
- **FR-023:** Archived accounts remain recoverable until an administrator restores or permanently deletes them; the application does not currently enforce an automatic expiry period.

## Scope and Requirement Status

The requirements above describe the current web application; they do not imply that every capability proposed in the original SRS has been delivered. In particular, the current application does not provide SMS one-time-password verification, social sign-in, a native technician mobile application, live technician location tracking, integrated payment processing, or instant booking confirmation. The marketplace workflow is based on customer requests, technician bids, customer selection, and accepted-task management.
