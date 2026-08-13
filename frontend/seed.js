// Demo data carried over from the prototype.
//
// Everything here backs a screen the API has no endpoint for yet — announcements,
// policy-update diffs, per-document version history, HR forms, the employee
// directory used by the access typeahead, and the two dashboard panels the
// /api/dashboard/charts response does not cover. It lives in one file so the seams
// are obvious: when an endpoint lands, delete the export and fetch instead.
//
// Anything that *does* have an endpoint (documents, conversations, chat, dashboard
// metrics) is fetched live and is deliberately absent from this file.

export const ANNOUNCEMENTS = [
  {
    id: 1,
    date: 'Aug 10, 2026',
    headline: 'Open enrollment closes Aug 29.',
    detail: 'Review your benefits elections in Workday before the deadline.',
  },
  {
    id: 2,
    date: 'Aug 4, 2026',
    headline: 'Updated Remote Work Policy published.',
    detail: 'Two remote days per week now require manager approval each quarter.',
  },
  {
    id: 3,
    date: 'Jul 28, 2026',
    headline: 'Payroll calendar for Q4 is available.',
    detail: 'Pay dates shift by one business day in November.',
  },
];

export const POLICY_UPDATES = [
  {
    id: 1,
    name: 'Remote Work Policy.pdf',
    date: 'Jun 2, 2026',
    prevDate: 'Feb 14, 2026',
    summary:
      'Remote days went from one to two per week, and core hours are now 10am–4pm local time instead of a fixed HQ window.',
    question: 'What changed in the Remote Work Policy?',
    previewTitle: 'REMOTE WORK POLICY',
    previewBody:
      '1. Eligibility\nEmployees may work remotely up to two days per week with manager approval.\n\n2. Core Hours\nRemote employees are expected to be reachable during core business hours, 10am–4pm local time.',
    prevBody:
      '1. Eligibility\nEmployees may work remotely up to one day per week with manager approval.\n\n2. Core Hours\nRemote employees are expected to be reachable from 9am–5pm headquarters time.',
  },
  {
    id: 2,
    name: 'Travel Policy.pdf',
    date: 'May 18, 2026',
    prevDate: 'Jan 6, 2026',
    summary:
      'The reimbursement window is now 30 days from travel, down from 60, and manager approval is required before booking.',
    question: 'What changed in the Travel Policy?',
    previewTitle: 'TRAVEL POLICY',
    previewBody:
      '1. Booking\nAll trips must be booked through the approved travel portal and approved by a manager in advance.\n\n2. Reimbursement\nSubmit itemized receipts within 30 days of travel to be eligible for reimbursement.',
    prevBody:
      '1. Booking\nTrips may be booked through any provider; approval can be obtained after the fact.\n\n2. Reimbursement\nSubmit itemized receipts within 60 days of travel to be eligible for reimbursement.',
  },
  {
    id: 3,
    name: 'Employee Handbook.pdf',
    date: 'Apr 30, 2026',
    prevDate: 'Oct 21, 2025',
    summary:
      'The leave section was rewritten to point to regional addenda, so local entitlements now take precedence over the handbook figure.',
    question: 'What changed in the Employee Handbook?',
    previewTitle: 'EMPLOYEE HANDBOOK',
    previewBody:
      '1. Overview\nThis handbook summarizes company-wide policies covering conduct, benefits, and leave.\n\n2. Updates\nHR reviews and republishes this handbook annually or when policy changes are approved.',
    prevBody:
      '1. Overview\nThis handbook summarizes company-wide policies covering conduct, benefits, and leave.\n\n2. Updates\nThe figures in this handbook apply globally unless an exception is granted by HR.',
  },
];

export const RESOURCE_FORMS = [
  { id: 1, name: 'Leave Request Form.pdf', meta: 'HR Forms · PDF' },
  { id: 2, name: 'Benefits Enrollment Form.pdf', meta: 'HR Forms · PDF' },
  { id: 3, name: 'Expense Reimbursement Form.pdf', meta: 'HR Forms · PDF' },
];

export const EMPLOYEE_DIRECTORY = [
  { name: 'Sam Rivera', dept: 'Engineering' },
  { name: 'John Smith', dept: 'Sales' },
  { name: 'Sarah Johnson', dept: 'People Ops' },
  { name: 'Michael Brown', dept: 'Finance' },
  { name: 'Emily Davis', dept: 'Marketing' },
  { name: 'Maya Sharma', dept: 'People Ops' },
  { name: 'Priya Raman', dept: 'Legal' },
  { name: 'Daniel Okoro', dept: 'Engineering' },
];

export const ACCESS_DEPARTMENTS = ['Engineering', 'Sales', 'People Ops', 'Finance', 'Marketing', 'Legal'];

// Group labels map onto the backend's three role values; see roleToGroup/groupToRole
// in api.js. Departments and named individuals are display-only for now — the
// upload endpoint only accepts roles.
export const ACCESS_GROUPS = ['All Employees', 'Managers', 'Executive Team'];

export const MOST_REFERENCED = [
  { name: 'Remote Work Policy.pdf', citations: 142 },
  { name: 'Expense Reimbursement Policy.pdf', citations: 118 },
  { name: 'Parental Leave Policy.pdf', citations: 96 },
  { name: 'Paid Time Off (PTO) Policy.pdf', citations: 74 },
  { name: 'Company Code of Conduct.pdf', citations: 51 },
];

// Slice colours for the category breakdown, in the prototype's order. Applied to
// whatever categories the charts endpoint actually returns.
export const BREAKDOWN_COLORS = ['#7c4dff', '#9a73ff', '#f2b04d', '#5ecb8f', 'rgba(244,242,249,.3)'];

export const RECENTLY_VIEWED_FALLBACK = [
  { name: 'Remote Work Policy.pdf', time: 'Viewed 2 hours ago' },
  { name: 'Travel Policy.pdf', time: 'Viewed yesterday' },
  { name: 'Employee Handbook.pdf', time: 'Viewed 3 days ago' },
];

// Prior versions, keyed by document title. The prototype keyed these by its own
// numeric ids; titles survive the switch to real documents with UUID keys.
export const DOC_VERSIONS = {
  'Parental Leave Policy': [{ version: 1, uploadedOn: 'Nov 3, 2025', uploadedBy: 'Maya Sharma', status: 'Approved' }],
  'Travel Policy': [
    { version: 1, uploadedOn: 'Aug 19, 2025', uploadedBy: 'Priya Raman', status: 'Approved' },
    { version: 2, uploadedOn: 'Jan 6, 2026', uploadedBy: 'Maya Sharma', status: 'Approved' },
  ],
  'Health Insurance Guide': [{ version: 1, uploadedOn: 'Feb 2, 2026', uploadedBy: 'Priya Raman', status: 'Approved' }],
  'Company Code of Conduct': [
    { version: 1, uploadedOn: 'Jul 14, 2025', uploadedBy: 'Daniel Okoro', status: 'Approved' },
    { version: 2, uploadedOn: 'Dec 1, 2025', uploadedBy: 'Maya Sharma', status: 'Approved' },
  ],
};

export const HOME_SUGGESTIONS = [
  'Can I work from home on Fridays?',
  'How do I get reimbursed for travel expenses?',
  'How many weeks of parental leave do I get?',
];

// Watermark tile positions from the prototype's secure document viewer.
export const WATERMARK_ROWS = [
  { top: '8%', left: '4%' },
  { top: '8%', left: '58%' },
  { top: '38%', left: '20%' },
  { top: '38%', left: '72%' },
  { top: '68%', left: '4%' },
  { top: '68%', left: '58%' },
];
