// HR admin views: dashboard, document management, the review screen, and the
// upload / version-history / new-version modals.

import { CATEGORIES } from './api.js';
import { icon } from './icons.js';
import {
  ACCESS_DEPARTMENTS,
  ACCESS_GROUPS,
  BREAKDOWN_COLORS,
  DOC_VERSIONS,
  EMPLOYEE_DIRECTORY,
  MOST_REFERENCED,
  POLICY_UPDATES,
} from './seed.js';
import { esc, state, userFirstName } from './store.js';

const selectedDoc = () => state.documents.find((d) => d.id === state.selectedDocId) || null;
const priorVersions = (doc) => (doc ? DOC_VERSIONS[doc.title] || [] : []);

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export function dashboardView() {
  const charts = state.charts || { top_questions: [], documents_by_category: [] };

  const questions = charts.top_questions.slice(0, 4);
  const qMax = Math.max(...questions.map((q) => q.value), 1);

  const cats = charts.documents_by_category.slice(0, 5);
  const catTotal = cats.reduce((sum, c) => sum + c.value, 0) || 1;

  const referenced = MOST_REFERENCED.map((m, i) => ({
    ...m,
    rank: i + 1,
    citationLabel: `${m.citations} citations`,
  }));

  return `
<div class="panel">
  <h1 class="admin-title">Welcome back, ${esc(userFirstName())}</h1>
  <p class="panel-sub">Here's what's happening with the HR assistant today.</p>
  <div class="dash-col" style="display:flex;flex-direction:row;align-items:center;gap:14px;margin-top:18px">
    <span class="mini-icon" style="flex:none">${icon('doc', 22)}</span>
    <div style="flex:1;min-width:0">
      <h2 class="section-label" style="margin:0 0 2px">Document Management</h2>
      <p class="panel-sub" style="margin:0">Upload, categorize, and approve policy documents</p>
    </div>
    <button class="ghost" data-act="go" data-arg="documents" style="flex:none;padding:6px 10px">Manage documents →</button>
  </div>
  <div class="dash-cols" style="margin-top:20px">
    <div class="dash-col">
      <div class="dash-col-head">
        <h2 class="section-label" style="margin:0">Common Employee Questions</h2>
      </div>
      ${
        questions.length
          ? questions
              .map(
                (q) => `<div class="bar-row">
        <span class="bar-label">${esc(q.label)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.round((q.value / qMax) * 100)}%"></div></div>
        <span class="bar-count">${q.value}</span>
      </div>`,
              )
              .join('')
          : '<p class="panel-sub">No questions have been asked yet.</p>'
      }
    </div>
    <div class="dash-col">
      <div class="dash-col-head">
        <h2 class="section-label" style="margin:0">Frequently Referenced Document Categories</h2>
      </div>
      <div class="donut-legend">
        ${
          cats.length
            ? cats
                .map(
                  (c, i) => `<div class="legend-row"><span class="legend-dot" style="background:${
                    BREAKDOWN_COLORS[i % BREAKDOWN_COLORS.length]
                  }"></span>${esc(c.label)} <span class="legend-pct">${Math.round((c.value / catTotal) * 100)}%</span></div>`,
                )
                .join('')
            : '<p class="panel-sub">No approved documents yet.</p>'
        }
      </div>
    </div>
  </div>
  <div class="dash-cols" style="margin-top:20px">
    <div class="dash-col">
      <div class="dash-col-head">
        <h2 class="section-label" style="margin:0">Most Referenced Documents</h2>
      </div>
      ${referenced
        .map(
          (m) => `<div class="mini-row">
        <span class="mini-badge">${m.rank}</span>
        <span class="mini-info">
          <span class="mini-title">${esc(m.name)}</span>
          <span class="mini-sub">${esc(m.citationLabel)}</span>
        </span>
      </div>`,
        )
        .join('')}
    </div>
    <div class="dash-col" style="display:flex;flex-direction:column">
      <div class="dash-col-head">
        <h2 class="section-label" style="margin:0">Recently Updated Policies</h2>
      </div>
      ${POLICY_UPDATES.map(
        (u) => `<div class="mini-row" style="flex-direction:column;align-items:stretch;padding:18px 0">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px">
          <span class="mini-title">${esc(u.name)}</span>
          <span class="mini-sub" style="flex:none">Updated ${esc(u.date)}</span>
        </div>
      </div>`,
      ).join('')}
      <button class="ghost" data-act="goPolicyUpdates" style="margin-top:auto;padding:14px 0 0;text-align:left;align-self:flex-start">View all updates →</button>
    </div>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// Document management
// ---------------------------------------------------------------------------

export function documentsView() {
  const tab = (key, label) =>
    `<button class="filter-tab ${state.docFilter === key ? 'active' : ''}" data-act="setDocFilter" data-arg="${key}">${label}</button>`;
  const docs = state.documents.filter((d) => state.docFilter === 'all' || d.status === state.docFilter);

  return `
<div class="panel">
  <div class="admin-header" style="padding:0 0 4px">
    <h1 class="admin-title">Document Management</h1>
    <button class="upload-btn" data-act="openUpload">Upload Document</button>
  </div>
  <div class="filter-tabs">
    ${tab('all', 'All Documents')}
    ${tab('Pending', 'Pending Approval')}
    ${tab('Approved', 'Approved')}
    ${tab('Rejected', 'Rejected')}
  </div>
  <div class="doc-table">
    <div class="doc-table-head">
      <span class="doc-col-name">Document Name</span>
      <span class="doc-col-cat">Category</span>
      <span class="doc-col-status">Status</span>
      <span class="doc-col-date">Uploaded On</span>
      <span class="doc-col-cat">Access</span>
      <span class="doc-col-action">Action</span>
    </div>
    ${docs
      .map(
        (p) => `<div class="doc-row">
      <span class="doc-col-name doc-name-cell">${icon(
        'doc',
        14,
        'style="flex:none;vertical-align:-2px;margin-right:0;color:#b79cff"',
      )}<span class="doc-name-text">${esc(p.name)}</span></span>
      <span class="doc-col-cat">${esc(p.category)}</span>
      <span class="doc-col-status"><span class="tag ${p.tagClass}">${esc(p.status)}</span></span>
      <span class="doc-col-date">${esc(p.uploadedOn)}</span>
      <span class="doc-col-cat">${esc(p.audienceLabel)}</span>
      <span class="doc-col-action">
        <span class="kebab-wrap">
          <button class="icon-link-btn" data-act="toggleDocMenu" data-arg="${esc(p.id)}" title="Actions" aria-label="Actions">${icon('kebab', 15)}</button>
          ${
            state.docMenuId === p.id
              ? `<div class="kebab-menu">
            <button class="kebab-item" data-act="reviewDoc" data-arg="${esc(p.id)}">View document</button>
            <button class="kebab-item" data-act="versionHistory" data-arg="${esc(p.id)}">Version history</button>
            <button class="kebab-item" data-act="newVersion" data-arg="${esc(p.id)}">Upload new version</button>
            <div class="kebab-divider"></div>
            <button class="kebab-item danger" data-act="removeDoc" data-arg="${esc(p.id)}">Remove document</button>
          </div>`
              : ''
          }
        </span>
      </span>
    </div>`,
      )
      .join('')}
    ${docs.length ? '' : '<div class="doc-row"><span class="panel-sub" style="padding:8px 0">No documents in this view.</span></div>'}
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// Access pickers, shared by the upload modal, the new-version modal and review
// ---------------------------------------------------------------------------

function checkList(items) {
  return `<div class="check-list">
    ${items
      .map(
        (it) => `<label class="check-item">
      <input type="checkbox" ${it.checked ? 'checked' : ''} data-act="${it.act}" data-arg="${esc(it.label)}">
      ${esc(it.label)}
    </label>`,
      )
      .join('')}
  </div>`;
}

function typeahead({ query, model, focusKey, pickAct, taken }) {
  const q = query.trim().toLowerCase();
  const matches = EMPLOYEE_DIRECTORY.filter((e) => e.name.toLowerCase().includes(q) && !taken.includes(e.name)).slice(0, 6);
  return `<div class="typeahead">
    <input class="field-text" type="text" placeholder="Search employees by name..." value="${esc(query)}"
           data-model="${model}" data-focus-key="${focusKey}">
    ${
      q
        ? `<div class="typeahead-menu">
      ${matches
        .map(
          (e) => `<button class="typeahead-item" data-act="${pickAct}" data-arg="${esc(e.name)}">${esc(e.name)} <span style="color:rgba(244,242,249,.4)">· ${esc(e.dept)}</span></button>`,
        )
        .join('')}
      ${matches.length ? '' : '<div class="typeahead-empty">No employees match that name.</div>'}
    </div>`
        : ''
    }
  </div>`;
}

function personChips(names, removeAct) {
  if (!names.length) return '';
  return `<div class="person-chips">
    ${names
      .map(
        (n) => `<span class="person-chip">${esc(n)}<button data-act="${removeAct}" data-arg="${esc(n)}" title="Remove" aria-label="Remove">✕</button></span>`,
      )
      .join('')}
  </div>`;
}

// The upload and new-version modals share one access block backed by the same
// draft state, exactly as the prototype did.
function draftAccessBlock() {
  return `
<div class="access-group" style="margin-top:6px">
  <p class="access-label">Groups</p>
  ${checkList(ACCESS_GROUPS.map((g) => ({ label: g, checked: !!state.accessGroups[g], act: 'toggleAccessGroup' })))}
</div>
<div class="access-group">
  <p class="access-label">Specific departments (optional)</p>
  ${checkList(ACCESS_DEPARTMENTS.map((d) => ({ label: d, checked: !!state.accessDepts[d], act: 'toggleAccessDept' })))}
</div>
<div class="access-group">
  <p class="access-label">Specific individuals (optional)</p>
  ${typeahead({
    query: state.peopleQuery,
    model: 'peopleQuery',
    focusKey: 'peopleQuery',
    pickAct: 'addAccessPerson',
    taken: state.accessPeople,
  })}
  ${personChips(state.accessPeople, 'removeAccessPerson')}
</div>`;
}

function categorySelect(value, act) {
  return `<div class="select-wrap">
    <select class="select-input" data-act="${act}">
      ${CATEGORIES.map((c) => `<option value="${esc(c)}"${c === value ? ' selected' : ''}>${esc(c)}</option>`).join('')}
    </select>
    ${icon('chevronDown', 14, 'class="select-arrow"')}
  </div>`;
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------

export function uploadModal() {
  if (!state.uploadModalOpen) return '';
  return `
<div class="modal-backdrop" data-act="closeUpload">
  <div class="modal-card" data-stop>
    <h2 class="modal-title">Upload Document</h2>
    <p class="field-label" style="margin:8px 0 6px">File name</p>
    <input class="field-text" type="text" readonly placeholder="e.g. Remote_Work_Policy.pdf"
           value="${esc(state.uploadName)}" data-act="pickFile" style="cursor:pointer">
    <input type="file" accept="application/pdf" id="uploadFileInput" hidden>
    <p class="field-label" style="margin:12px 0 6px">AI-suggested category</p>
    ${categorySelect(state.uploadCategory, 'setUploadCategory')}
    <p class="field-label" style="margin:14px 0 6px">Who can access this document?</p>
    ${draftAccessBlock()}
    <p class="modal-note-hint">The document is submitted as Pending. It becomes available to selected groups once approved.</p>
    <div class="modal-actions">
      <button class="modal-cancel" data-act="closeUpload">Cancel</button>
      <button class="modal-submit" data-act="submitUpload" ${state.uploadBusy ? 'disabled' : ''}>${state.uploadBusy ? 'Uploading…' : 'Upload'}</button>
    </div>
  </div>
</div>`;
}

export function versionHistoryModal() {
  if (!state.versionHistoryDocId) return '';
  const doc = state.documents.find((d) => d.id === state.versionHistoryDocId);
  if (!doc) return '';
  const priors = priorVersions(doc);
  const rows = [
    { version: priors.length + 1, uploadedOn: doc.uploadedOn, uploadedBy: 'Maya Sharma', status: doc.status, tagClass: doc.tagClass, isCurrent: true },
    ...priors
      .slice()
      .reverse()
      .map((v) => ({ ...v, tagClass: v.status === 'Approved' ? 'tag-approved' : v.status === 'Rejected' ? 'tag-rejected' : 'tag-pending', isCurrent: false })),
  ];

  return `
<div class="modal-backdrop" data-act="closeVersionHistory">
  <div class="modal-card" style="max-width:640px" data-stop>
    <h2 class="modal-title">Version history</h2>
    <p class="panel-sub" style="margin:6px 0 0">${esc(doc.name)}</p>
    <div class="ver-list">
      <div class="ver-row"><span>Version</span><span>Uploaded</span><span>Uploaded by</span><span>Status</span><span></span></div>
      ${rows
        .map(
          (v) => `<div class="ver-row">
        <span class="ver-num">v${v.version}</span>
        <span class="ver-muted">${esc(v.uploadedOn)}</span>
        <span class="ver-muted">${esc(v.uploadedBy)}</span>
        <span><span class="tag ${v.tagClass}">${esc(v.status)}</span></span>
        <span>${
          v.isCurrent
            ? '<span class="ver-muted">Current</span>'
            : `<button class="row-link" data-act="reviewDoc" data-arg="${esc(doc.id)}">View →</button>`
        }</span>
      </div>`,
        )
        .join('')}
    </div>
    <div class="modal-actions">
      <button class="modal-cancel" data-act="closeVersionHistory">Close</button>
    </div>
  </div>
</div>`;
}

export function newVersionModal() {
  if (!state.newVersionDocId) return '';
  const doc = state.documents.find((d) => d.id === state.newVersionDocId);
  if (!doc) return '';
  const current = priorVersions(doc).length + 1;

  return `
<div class="modal-backdrop" data-act="closeNewVersion">
  <div class="modal-card" data-stop>
    <h2 class="modal-title">Upload new version</h2>
    <p class="panel-sub" style="margin:6px 0 4px">Replacing ${esc(doc.name)} — currently v${current}</p>
    <p class="field-label" style="margin:8px 0 6px">File</p>
    <input class="field-text" type="text" readonly placeholder="e.g. Remote_Work_Policy_v${current + 1}.pdf"
           value="${esc(state.newVersionName)}" data-act="pickFile" style="cursor:pointer">
    <input type="file" accept="application/pdf" id="uploadFileInput" hidden>
    <p class="field-label" style="margin:14px 0 6px">What changed? (optional)</p>
    <textarea class="note-field" rows="3" placeholder="Describe the update for employees, e.g. remote days increased from one to two per week."
              data-model="newVersionSummary" data-focus-key="newVersionSummary">${esc(state.newVersionSummary)}</textarea>
    <p class="field-label" style="margin:14px 0 6px">Who can access this document?</p>
    ${draftAccessBlock()}
    <p class="modal-note-hint" style="margin-top:12px">This becomes v${current + 1} once approved. Employees will see an AI-generated summary of what changed on their homepage. The previous version stays accessible in version history.</p>
    <div class="modal-actions">
      <button class="modal-cancel" data-act="closeNewVersion">Cancel</button>
      <button class="modal-submit" data-act="submitNewVersion" ${state.uploadBusy ? 'disabled' : ''}>${state.uploadBusy ? 'Uploading…' : 'Upload'}</button>
    </div>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// Review screen
// ---------------------------------------------------------------------------

export function reviewView() {
  const doc = selectedDoc();
  const back = '<button class="back-link" style="text-align:left;margin:0 0 14px" data-act="go" data-arg="documents">← Back to Documents</button>';
  if (!doc) return `<div class="panel">${back}<p class="panel-sub">Select a document from Document Management.</p></div>`;

  const people = doc.audience.filter((a) => EMPLOYEE_DIRECTORY.some((e) => e.name === a));

  return `
<div class="panel">
  ${back}
  <div class="review-header">
    <span class="review-icon">${icon('doc', 20)}</span>
    <div>
      <h1 class="admin-title" style="margin:0">${esc(doc.name)}</h1>
      <p class="policy-meta">Uploaded ${esc(doc.uploadedOn)}</p>
    </div>
  </div>
  <div class="review-grid">
    <div class="review-card">
      <h2 class="section-label" style="margin-top:0">AI Suggested Category</h2>
      <p class="panel-sub" style="margin:0 0 14px">Our AI model analyzed this document and suggests the following category.</p>
      <div class="ai-suggestion">${esc(doc.category)} ${
        doc.confidence != null ? `<span class="ai-confidence">(${doc.confidence}% confidence)</span>` : ''
      }</div>
      <p class="field-label" style="margin:16px 0 6px">Category</p>
      ${categorySelect(doc.category, 'changeCategory')}
    </div>
    <div class="review-card">
      <h2 class="section-label" style="margin-top:0">Approval Workflow</h2>
      <div class="workflow-status-row"><span class="policy-meta">Status</span><span class="tag ${doc.tagClass}">${esc(doc.status)}</span></div>
      ${
        doc.status === 'Pending'
          ? `<p class="panel-sub" style="margin:0 0 12px">Only approved documents become available to the chatbot.</p>
      <button class="approve-btn" data-act="approveDoc" data-arg="${esc(doc.id)}">Approve Document</button>
      <button class="reject-btn" data-act="rejectDoc" data-arg="${esc(doc.id)}">Reject Document</button>`
          : doc.status === 'Approved'
            ? `<p class="workflow-note">This document is live and available to the chatbot. Approved on ${esc(doc.decidedOn)}.</p>`
            : `<p class="workflow-note">This document was rejected on ${esc(doc.decidedOn)}.${
                doc.rejectionComment ? ` ${esc(doc.rejectionComment)}` : ''
              }</p>`
      }
    </div>
  </div>
  <div class="review-card" style="margin:0 0 24px">
    <h2 class="section-label" style="margin-top:0">Visible To</h2>
    <p class="panel-sub" style="margin:0 0 12px">Choose which user groups can access this document once approved.</p>
    <div class="access-group" style="margin-top:0">
      <p class="access-label">Groups</p>
      ${checkList(ACCESS_GROUPS.map((g) => ({ label: g, checked: doc.audience.includes(g), act: 'toggleReviewGroup' })))}
    </div>
    <div class="access-group">
      <p class="access-label">Specific departments (optional)</p>
      ${checkList(ACCESS_DEPARTMENTS.map((d) => ({ label: d, checked: doc.audience.includes(d), act: 'toggleReviewDept' })))}
    </div>
    <div class="access-group">
      <p class="access-label">Specific individuals (optional)</p>
      ${typeahead({
        query: state.reviewPeopleQuery,
        model: 'reviewPeopleQuery',
        focusKey: 'reviewPeopleQuery',
        pickAct: 'addReviewPerson',
        taken: people,
      })}
      ${personChips(people, 'removeReviewPerson')}
    </div>
  </div>
  <div class="doc-viewer ${state.docViewerFullscreen ? 'fullscreen' : ''}">
    <div class="doc-viewer-toolbar">
      <span class="doc-viewer-filename">${icon('docSmall', 14)}${esc(doc.name)}</span>
      <span class="doc-viewer-toolbar-actions">
        <button class="doc-viewer-download" data-act="toggleReviewFullscreen" title="Toggle full screen" aria-label="Toggle full screen">
          ${state.docViewerFullscreen ? icon('collapse', 15) : icon('expand', 15)}
        </button>
        <button class="doc-viewer-download" data-act="downloadDoc" data-arg="${esc(doc.id)}" title="Download" aria-label="Download">${icon('download', 15)}</button>
      </span>
    </div>
    <div class="doc-viewer-page">
      ${
        state.reviewBlobUrl
          ? `<iframe src="${state.reviewBlobUrl}" title="${esc(doc.name)}" style="width:100%;height:100%;border:0;background:#fff"></iframe>`
          : `<div class="pdf-preview-title">${esc(doc.previewTitle)}</div><p class="pdf-preview-body">Loading document…</p>`
      }
    </div>
  </div>
</div>`;
}
