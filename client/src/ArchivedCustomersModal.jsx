import { useEffect, useState } from 'react';
import { api, rupees } from './api.js';

export default function ArchivedCustomersModal({ isOpen, onClose, onRestored, onError }) {
  const [archivedList, setArchivedList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState(null);
  const [successMsg, setSuccessMsg] = useState('');

  const loadArchived = async () => {
    try {
      setLoading(true);
      const list = await api.listArchived();
      setArchivedList(list || []);
    } catch (e) {
      onError?.(e.message || 'Failed to load archived customers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setSuccessMsg('');
      loadArchived();
    }
  }, [isOpen]);

  const handleRestore = async (id, name) => {
    try {
      setRestoringId(id);
      await api.restoreCustomer(id);
      setArchivedList((prev) => prev.filter((c) => c._id !== id));
      setSuccessMsg(`"${name}" has been restored to your active customers list.`);
      if (onRestored) await onRestored();
    } catch (err) {
      onError?.(err.message || 'Failed to restore customer');
    } finally {
      setRestoringId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="voice-modal-backdrop" onClick={onClose}>
      <div className="modal-dialog-card archived-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-dialog-header">
          <div className="archived-modal-title">
            <svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20" className="archive-header-icon">
              <path d="M4 3a2 2 0 100 4h12a2 2 0 100-4H4z" />
              <path fillRule="evenodd" d="M3 8h14v7a2 2 0 01-2 2H5a2 2 0 01-2-2V8zm5 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" clipRule="evenodd" />
            </svg>
            <h3>Archived Customers</h3>
          </div>
          <button type="button" className="voice-close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body-content">
          <p className="archived-intro-text">
            These customer accounts have been settled (0.00 balance) and archived from the active directory.
            Their ledger history remains permanently saved. You can restore any customer at any time.
          </p>

          {successMsg && (
            <div className="restore-success-banner">
              <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
              </svg>
              <span>{successMsg}</span>
            </div>
          )}

          {loading ? (
            <div className="archived-loading">
              <span className="spinner-dot" />
              <span>Loading archived accounts...</span>
            </div>
          ) : archivedList.length === 0 ? (
            <div className="archived-empty-state">
              <p>No archived customers.</p>
              <span className="archived-empty-sub">
                Customers can only be archived when their account balance is completely settled (₹0.00).
              </span>
            </div>
          ) : (
            <div className="archived-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Phone</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {archivedList.map((c) => (
                    <tr key={c._id}>
                      <td className="archived-name-cell">
                        <strong>{c.name}</strong>
                      </td>
                      <td className="archived-phone-cell">
                        {c.phone || <span className="muted-text">None</span>}
                      </td>
                      <td>
                        <span className="cleared-tag">Settled ({rupees(c.balancePaise || 0)})</span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-restore-action"
                          disabled={restoringId === c._id}
                          onClick={() => handleRestore(c._id, c.name)}
                        >
                          {restoringId === c._id ? 'Restoring...' : 'Restore'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="voice-btn-cancel" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
