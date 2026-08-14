// HR admin views: dashboard, document library, review, the upload / version
// modals, and the employee-request inbox.

import { inboxTagClass, shortDate } from './api.js';
import { icon } from './icons.js';
import { esc, state, userFirstName } from './store.js';

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export function dashboardView() {
  const charts = state.charts || { top_questions: [], most_referenced: [] };
  const questions = charts.top_questions.slice(0, 4);
  const qMax = Math.max(...questions.map((q) => q.value), 1);
  const referenced = charts.most_referenced || [];

  return `
<div class="panel">
  <h1 class="admin-title" style="margin-bottom:4px">Welcome back, ${esc(userFirstName())}</h1>
  <p class="panel-sub" style="margin:0">Here's what's happening with the HR assistant today.</p>
  <div class="dash-col" style="display:flex;flex-direction:row;align-items:center;gap:16px;margin-top:20px;padding:16px 20px">
    <span class="mini-icon" style="flex:none;width:38px;height:38px;background:rgba(124,77,255,.16)">${icon('doc', 22)}</span>
    <div style="flex:1;min-width:0">
      <h2 class="section-label" style="margin:0 0 2px">Document Management</h2>
      <p class="panel-sub" style="margin:0">Upload and manage policy documents</p>
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
        <h2 class="section-label" style="margin:0">Most Referenced Documents</h2>
      </div>
      ${
        referenced.length
          ? referenced
              .map(
                (m) => `<div class="mini-row">
        <span class="mini-badge">${m.rank}</span>
        <span class="mini-info">
          <span class="mini-title">${esc(m.name)}</span>
          <span class="mini-sub">${m.citations} citation${m.citations === 1 ? '' : 's'}</span>
        </span>
      </div>`,
              )
              .join('')
          : '<p class="panel-sub">No documents have been cited yet.</p>'
      }
    </div>
    <div class="dash-col" style="display:flex;flex-direction:column">
      <div class="dash-col-head">
        <h2 class="section-label" style="margin:0">Recently Updated Policies</h2>
      </div>
      ${
        state.updates.length
          ? state.updates
              .map(
                (u) => `<div class="mini-row" style="align-items:flex-start">
        <span style="flex:none;width:6px;height:6px;border-radius:50%;background:#7c4dff;margin-top:6px"></span>
        <span class="mini-info">
          <span class="mini-title">${esc(u.name)}</span>
          <span class="mini-sub">Updated ${esc(shortDate(u.updated_at))}</span>
        </span>
      </div>`,
              )
              .join('')
          : '<p class="panel-sub">No policies have been revised yet.</p>'
      }
      <button class="ghost" data-act="goPolicyUpdates" style="margin-top:auto;padding:16px 0 0;text-align:left;align-self:flex-start;border:none;background:none">View all updates →</button>
    </div>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// Document library
// ---------------------------------------------------------------------------

export function documentsView() {
  const q = state.docNameSearch.trim().toLowerCase();
  const docs = state.documents.filter((d) => !q || d.name.toLowerCase().includes(q));

  return `
<div class="panel">
  <div class="admin-header" style="padding:0 0 4px">
    <h1 class="admin-title">Document Management</h1>
    <button class="upload-btn" data-act="openUpload">Upload Document</button>
  </div>
  <div class="doc-search">
    ${icon('search', 15)}
    <input type="text" placeholder="Search document names..." value="${esc(state.docNameSearch)}"
           data-model="docNameSearch" data-focus-key="docNameSearch" data-live aria-label="Search document names">
  </div>
  <div class="doc-table">
    <div class="doc-table-head">
      <span class="doc-col-name">Document Name</span>
      <span class="doc-col-date">Uploaded On</span>
      <span class="doc-col-action">Action</span>
    </div>
    ${docs
      .map(
        (p) => `<div class="doc-row">
      <span class="doc-col-name doc-name-cell">${icon('doc', 14, 'style="flex:none;vertical-align:-2px;margin-right:0;color:#b79cff"')}<span class="doc-name-text">${esc(p.name)}</span></span>
      <span class="doc-col-date">${esc(p.uploadedOn)}</span>
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
    ${docs.length ? '' : '<div class="doc-empty">No documents match your search.</div>'}
  </div>
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
    <p class="modal-note-hint">This document becomes available to all employees immediately upon upload.</p>
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

  return `
<div class="modal-backdrop" data-act="closeVersionHistory">
  <div class="modal-card" style="max-width:640px" data-stop>
    <h2 class="modal-title">Version history</h2>
    <p class="panel-sub" style="margin:6px 0 0">${esc(doc.name)}</p>
    <div class="ver-list">
      <div class="ver-row"><span>Version</span><span>Uploaded</span><span>Uploaded by</span><span></span></div>
      ${state.versionRows
        .map(
          (v) => `<div class="ver-row">
        <span class="ver-num">v${v.version_number}</span>
        <span class="ver-muted">${esc(shortDate(v.uploaded_at))}</span>
        <span class="ver-muted">${esc(v.uploaded_by_name || '—')}</span>
        <span>${
          v.is_current
            ? '<span class="ver-muted">Current</span>'
            : `<button class="row-link" data-act="viewVersion" data-arg="${v.version_number}">View →</button>`
        }</span>
      </div>`,
        )
        .join('')}
      ${state.versionRows.length ? '' : '<div class="ver-row"><span class="ver-muted">Loading…</span></div>'}
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
  const current = state.versionRows.length ? Math.max(...state.versionRows.map((v) => v.version_number)) : 1;

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
    <p class="modal-note-hint" style="margin-top:12px">This becomes v${current + 1} immediately. Employees will see an AI-generated summary of what changed on their homepage. The previous version stays accessible in version history.</p>
    <div class="modal-actions">
      <button class="modal-cancel" data-act="closeNewVersion">Cancel</button>
      <button class="modal-submit" data-act="submitNewVersion" ${state.uploadBusy ? 'disabled' : ''}>${state.uploadBusy ? 'Uploading…' : 'Upload'}</button>
    </div>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

export function reviewView() {
  const doc = state.documents.find((d) => d.id === state.selectedDocId);
  const back = '<button class="back-link" style="text-align:left;margin:0 0 14px" data-act="go" data-arg="documents">← Back to Documents</button>';
  if (!doc) return `<div class="panel">${back}<p class="panel-sub">Select a document from Document Management.</p></div>`;

  return `
<div class="panel">
  ${back}
  <div class="review-header">
    <span class="review-icon">${icon('doc', 20)}</span>
    <div>
      <h1 class="admin-title" style="margin:0">${esc(doc.name)}</h1>
      <p class="policy-meta">Uploaded ${esc(doc.uploadedOn)}${doc.version ? ` · ${esc(doc.version)}` : ''}</p>
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

// ---------------------------------------------------------------------------
// Employee request inbox
//
// The prototype export carries this screen's handlers, filters and CSS
// (.inbox-col-*, .inbox-btn-group) but renders no markup for it, so the layout
// below is built from those classes and the Request Context modal it feeds.
// ---------------------------------------------------------------------------

export function inboxView() {
  const tab = (key, label) =>
    `<button class="filter-tab ${state.inboxFilter === key ? 'active' : ''}" data-act="setInboxFilter" data-arg="${esc(key)}">${label}</button>`;

  return `
<div class="panel">
  <h1 class="admin-title">Employee Requests</h1>
  <p class="panel-sub" style="margin:4px 0 0">Questions the assistant escalated to HR.</p>
  <div class="doc-search">
    ${icon('search', 15)}
    <input type="text" placeholder="Search by employee or question..." value="${esc(state.inboxSearch)}"
           data-model="inboxSearch" data-focus-key="inboxSearch" data-live aria-label="Search requests">
  </div>
  <div class="filter-tabs" style="margin:14px 0 14px">
    ${tab('all', 'All')}
    ${tab('New', 'New')}
    ${tab('In Progress', 'In Progress')}
    ${tab('Resolved', 'Resolved')}
  </div>
  <div class="doc-table">
    <div class="doc-table-head">
      <span class="inbox-col-cat">Employee</span>
      <span class="doc-col-name">Question</span>
      <span class="inbox-col-date">Received</span>
      <span class="inbox-col-view">Status</span>
      <span class="inbox-col-action">Action</span>
    </div>
    ${state.inbox
      .map(
        (r) => `<div class="doc-row">
      <span class="inbox-col-cat doc-name-cell">${esc(r.employee_name || 'Unknown')}</span>
      <span class="doc-col-name"><span class="doc-name-text">${esc(r.question || r.message)}</span></span>
      <span class="inbox-col-date">${esc(shortDate(r.created_at))}</span>
      <span class="inbox-col-view"><span class="tag ${inboxTagClass(r.status)}">${esc(r.status)}</span></span>
      <span class="inbox-col-action">
        <span class="inbox-btn-group">
          <button class="row-link" data-act="viewRequest" data-arg="${esc(r.id)}">View →</button>
        </span>
      </span>
    </div>`,
      )
      .join('')}
    ${state.inbox.length ? '' : '<div class="doc-empty">No requests match this view.</div>'}
  </div>
</div>`;
}

export function requestDetailModal() {
  if (!state.requestDetailId) return '';
  const r = state.inbox.find((x) => x.id === state.requestDetailId);
  if (!r) return '';

  const sources = r.citations || [];
  const isNew = r.status === 'New';
  const isInProgress = r.status === 'In Progress';
  const isResolved = r.status === 'Resolved';
  const justSent = state.hrResponseJustSentId === r.id;

  return `
<div class="modal-backdrop" data-act="closeRequestDetail">
  <div class="modal-card" data-stop>
    <div class="modal-banner">
      <span class="modal-banner-icon">ⓘ</span>
      <span class="modal-banner-text">The assistant could not answer this from an approved company policy, so it was escalated to HR.</span>
    </div>
    <h2 class="modal-title">Request Context</h2>
    <p class="modal-sub">${esc(r.employee_name || 'Unknown')} — ${esc(shortDate(r.created_at))}</p>
    <div class="request-summary">
      <div class="summary-section">
        <p class="summary-label">Status</p>
        <p class="summary-value"><span class="tag ${inboxTagClass(r.status)}">${esc(r.status)}</span></p>
      </div>
      <div class="summary-divider"></div>
      <div class="summary-section">
        <p class="summary-label">Employee Question</p>
        <p class="summary-value">${esc(r.question || '—')}</p>
      </div>
      <div class="summary-divider"></div>
      <div class="summary-section">
        <p class="summary-label">AI Response</p>
        <p class="summary-value">${esc(r.ai_response || '—')}</p>
      </div>
      <div class="summary-divider"></div>
      <div class="summary-section">
        <p class="summary-label">Supporting Policy Sources</p>
        ${
          sources.length
            ? `<div class="preview-tags">${sources.map((s) => `<span class="tag">${esc(s)}</span>`).join('')}</div>`
            : '<p class="summary-empty">No approved company policy matched this request.</p>'
        }
      </div>
    </div>
    <p class="field-label" style="margin:2px 0 0">Additional details from employee</p>
    <p class="summary-value" style="background:#241f31;border:1px solid rgba(255,255,255,.09);border-radius:10px;padding:12px 14px">${esc(r.employee_note || 'None')}</p>
    ${
      isResolved
        ? `<p class="field-label" style="margin:14px 0 6px">HR response</p>
      <p class="summary-value">${esc(r.hr_response || '—')}</p>`
        : `<p class="field-label" style="margin:14px 0 6px">HR response</p>
      <textarea class="note-field" placeholder="Write your response to the employee…"
                data-model="hrResponseDraft" data-focus-key="hrResponseDraft" ${justSent ? 'disabled' : ''}>${esc(state.hrResponseDraft)}</textarea>
      ${justSent ? `<p style="font-size:12.5px;color:#7fd99a;display:flex;align-items:center;gap:6px;margin:8px 0 0">✓ Response sent successfully to ${esc(r.employee_name)}.</p>` : ''}`
    }
    <div class="modal-actions">
      <button class="modal-cancel" data-act="closeRequestDetail">Close</button>
      ${isNew ? `<button class="modal-submit" data-act="startRequest" data-arg="${esc(r.id)}">Start</button>` : ''}
      ${
        isInProgress || isNew
          ? `<button class="modal-submit" data-act="respondRequest" data-arg="${esc(r.id)}" ${state.hrResponseSending ? 'disabled' : ''}>${state.hrResponseSending ? 'Sending…' : 'Respond'}</button>
      <button class="modal-submit" data-act="resolveRequest" data-arg="${esc(r.id)}">Resolve</button>`
          : ''
      }
    </div>
  </div>
</div>`;
}
