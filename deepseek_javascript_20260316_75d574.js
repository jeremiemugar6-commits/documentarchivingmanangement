// document-management-client.js
// A complete client library for external systems to interact with the Document Management System

import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, set, push, update, remove, query, orderByChild, equalTo } from 'firebase/database';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';

/**
 * Document Management System Client
 * For connecting external systems to the Maharlika National Service Document Archive
 */
class DocumentManagementClient {
  constructor(config = {}) {
    // Default Firebase configuration
    this.firebaseConfig = {
      apiKey: config.apiKey || "AIzaSyD9fUB684Se4y-K3G2uhLAd8cksv1U0WGE",
      authDomain: config.authDomain || "documentarchiving-2d90e.firebaseapp.com",
      databaseURL: config.databaseURL || "https://documentarchiving-2d90e-default-rtdb.asia-southeast1.firebasedatabase.app",
      projectId: config.projectId || "documentarchiving-2d90e",
      storageBucket: config.storageBucket || "documentarchiving-2d90e.firebasestorage.app",
      messagingSenderId: config.messagingSenderId || "743826921409",
      appId: config.appId || "1:743826921409:web:79380c166cbd77d48ec140",
      measurementId: config.measurementId || "G-1TVE9GTVWL"
    };

    // Initialize Firebase
    this.app = initializeApp(this.firebaseConfig, `doc-client-${Date.now()}`);
    this.db = getDatabase(this.app);
    this.storage = getStorage(this.app);
    
    // System identification
    this.systemId = config.systemId || 'external-system';
    this.systemName = config.systemName || 'External System';
  }

  /**
   * ============================================
   * DOCUMENT OPERATIONS
   * ============================================
   */

  /**
   * Get all documents (with optional filters)
   * @param {Object} filters - Filter criteria
   * @returns {Promise<Array>} - Array of documents
   */
  async getDocuments(filters = {}) {
    try {
      const snapshot = await get(ref(this.db, 'documents'));
      if (!snapshot.exists()) return [];

      let documents = [];
      snapshot.forEach(child => {
        documents.push({
          id: child.key,
          ...child.val()
        });
      });

      // Apply filters
      if (filters.department) {
        documents = documents.filter(doc => doc.type === filters.department);
      }
      if (filters.status) {
        documents = documents.filter(doc => doc.status === filters.status);
      }
      if (filters.subject) {
        documents = documents.filter(doc => 
          doc.subject.toLowerCase().includes(filters.subject.toLowerCase())
        );
      }
      if (filters.deleted !== undefined) {
        documents = documents.filter(doc => doc.deleted === filters.deleted);
      }

      return documents;
    } catch (error) {
      console.error('Error fetching documents:', error);
      throw new Error(`Failed to fetch documents: ${error.message}`);
    }
  }

  /**
   * Get documents by department
   * @param {string} departmentType - Department document type
   * @returns {Promise<Array>} - Array of documents
   */
  async getDocumentsByDepartment(departmentType) {
    return this.getDocuments({ department: departmentType });
  }

  /**
   * Get documents by subject (personnel)
   * @param {string} subject - Person's name
   * @returns {Promise<Array>} - Array of documents
   */
  async getDocumentsBySubject(subject) {
    return this.getDocuments({ subject });
  }

  /**
   * Get single document by ID
   * @param {string} documentId - Document ID
   * @returns {Promise<Object|null>} - Document object or null
   */
  async getDocumentById(documentId) {
    try {
      // Search by numeric ID (as stored in your system)
      const allDocs = await this.getDocuments();
      return allDocs.find(doc => doc.id === parseInt(documentId)) || null;
    } catch (error) {
      console.error('Error fetching document:', error);
      throw new Error(`Failed to fetch document: ${error.message}`);
    }
  }

  /**
   * Create a new document
   * @param {Object} documentData - Document data
   * @returns {Promise<Object>} - Created document
   */
  async createDocument(documentData) {
    try {
      // Get next available ID
      const allDocs = await this.getDocuments();
      const nextId = allDocs.length > 0 
        ? Math.max(...allDocs.map(d => d.id || 0)) + 1 
        : 1;

      const newDoc = {
        id: nextId,
        type: documentData.type,
        version: documentData.version || 1,
        subject: documentData.subject,
        location: documentData.location,
        status: documentData.status || 'ACTIVE',
        expiry: documentData.expiry,
        backed: false,
        deleted: false,
        fileUrl: documentData.fileUrl || null,
        fileName: documentData.fileName || null,
        createdAt: new Date().toISOString(),
        createdBy: this.systemId
      };

      const docRef = push(ref(this.db, 'documents'));
      await set(docRef, newDoc);

      // Add audit log
      await this.addAuditLog({
        op: 'DOCUMENT_CREATED',
        doc: newDoc.type,
        user: this.systemId,
        details: `Document created by ${this.systemName}`
      });

      return { id: docRef.key, ...newDoc };
    } catch (error) {
      console.error('Error creating document:', error);
      throw new Error(`Failed to create document: ${error.message}`);
    }
  }

  /**
   * Update document
   * @param {string} documentId - Document ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} - Updated document
   */
  async updateDocument(documentId, updates) {
    try {
      const doc = await this.getDocumentById(documentId);
      if (!doc) throw new Error('Document not found');

      const docRef = ref(this.db, `documents/${doc._fbKey}`);
      await update(docRef, updates);

      // Add audit log
      await this.addAuditLog({
        op: 'DOCUMENT_MODIFIED',
        doc: doc.type,
        user: this.systemId,
        details: `Document updated by ${this.systemName}: ${Object.keys(updates).join(', ')}`
      });

      return { ...doc, ...updates };
    } catch (error) {
      console.error('Error updating document:', error);
      throw new Error(`Failed to update document: ${error.message}`);
    }
  }

  /**
   * Delete document (soft delete)
   * @param {string} documentId - Document ID
   * @returns {Promise<boolean>} - Success status
   */
  async deleteDocument(documentId) {
    return this.updateDocument(documentId, { deleted: true });
  }

  /**
   * Permanently delete document
   * @param {string} documentId - Document ID
   * @returns {Promise<boolean>} - Success status
   */
  async permanentlyDeleteDocument(documentId) {
    try {
      const doc = await this.getDocumentById(documentId);
      if (!doc) throw new Error('Document not found');

      await remove(ref(this.db, `documents/${doc._fbKey}`));

      // Add audit log
      await this.addAuditLog({
        op: 'DOCUMENT_PERMANENTLY_DELETED',
        doc: doc.type,
        user: this.systemId,
        details: `Document permanently deleted by ${this.systemName}`
      });

      return true;
    } catch (error) {
      console.error('Error permanently deleting document:', error);
      throw new Error(`Failed to permanently delete document: ${error.message}`);
    }
  }

  /**
   * ============================================
   * DOCUMENT STATUS OPERATIONS
   * ============================================
   */

  /**
   * Borrow a document
   * @param {string} documentId - Document ID
   * @param {string} requester - Person requesting
   * @returns {Promise<Object>} - Borrow request
   */
  async requestBorrow(documentId, requester) {
    try {
      const doc = await this.getDocumentById(documentId);
      if (!doc) throw new Error('Document not found');

      const borrowRequest = {
        docId: documentId,
        docType: doc.type,
        version: doc.version,
        subject: doc.subject,
        requester: requester,
        requestedAt: new Date().toISOString(),
        status: 'PENDING',
        systemId: this.systemId
      };

      const requestRef = push(ref(this.db, 'borrowRequests'));
      await set(requestRef, borrowRequest);

      // Add audit log
      await this.addAuditLog({
        op: 'DOCUMENT_REQUESTED',
        doc: doc.type,
        user: this.systemId,
        details: `Borrow request by ${requester} from ${this.systemName}`
      });

      return { id: requestRef.key, ...borrowRequest };
    } catch (error) {
      console.error('Error requesting borrow:', error);
      throw new Error(`Failed to request borrow: ${error.message}`);
    }
  }

  /**
   * Return a borrowed document
   * @param {string} documentId - Document ID
   * @returns {Promise<boolean>} - Success status
   */
  async returnDocument(documentId) {
    try {
      const doc = await this.getDocumentById(documentId);
      if (!doc) throw new Error('Document not found');

      await this.updateDocument(documentId, { status: 'ACTIVE' });

      // Add audit log
      await this.addAuditLog({
        op: 'DOCUMENT_RETURNED',
        doc: doc.type,
        user: this.systemId,
        details: `Document returned by ${this.systemName}`
      });

      return true;
    } catch (error) {
      console.error('Error returning document:', error);
      throw new Error(`Failed to return document: ${error.message}`);
    }
  }

  /**
   * Archive a document
   * @param {string} documentId - Document ID
   * @returns {Promise<boolean>} - Success status
   */
  async archiveDocument(documentId) {
    return this.updateDocument(documentId, { status: 'ARCHIVED' });
  }

  /**
   * Unarchive a document
   * @param {string} documentId - Document ID
   * @returns {Promise<boolean>} - Success status
   */
  async unarchiveDocument(documentId) {
    return this.updateDocument(documentId, { status: 'ACTIVE' });
  }

  /**
   * ============================================
   * FILE OPERATIONS
   * ============================================
   */

  /**
   * Upload file for a document
   * @param {string} documentId - Document ID
   * @param {File|Blob} file - File to upload
   * @param {string} fileName - File name
   * @returns {Promise<string>} - Download URL
   */
  async uploadDocumentFile(documentId, file, fileName) {
    try {
      const doc = await this.getDocumentById(documentId);
      if (!doc) throw new Error('Document not found');

      const fileRef = storageRef(this.storage, `documents/${documentId}_${Date.now()}_${fileName}`);
      await uploadBytes(fileRef, file);
      const downloadUrl = await getDownloadURL(fileRef);

      // Update document with file info
      await this.updateDocument(documentId, {
        fileUrl: downloadUrl,
        fileName: fileName
      });

      // Add audit log
      await this.addAuditLog({
        op: 'DOCUMENT_UPLOADED',
        doc: doc.type,
        user: this.systemId,
        details: `File uploaded: ${fileName}`
      });

      return downloadUrl;
    } catch (error) {
      console.error('Error uploading file:', error);
      throw new Error(`Failed to upload file: ${error.message}`);
    }
  }

  /**
   * ============================================
   * BACKUP OPERATIONS
   * ============================================
   */

  /**
   * Create a backup of a document
   * @param {string} documentId - Document ID
   * @returns {Promise<Object>} - Backup record
   */
  async createBackup(documentId) {
    try {
      const doc = await this.getDocumentById(documentId);
      if (!doc) throw new Error('Document not found');

      // Remove Firebase key before backup
      const { _fbKey, ...docData } = doc;
      
      const backupRef = push(ref(this.db, 'backups'));
      await set(backupRef, {
        ...docData,
        backedAt: new Date().toISOString(),
        backedBy: this.systemId
      });

      // Mark document as backed up
      await this.updateDocument(documentId, { backed: true });

      // Add audit log
      await this.addAuditLog({
        op: 'DOCUMENT_BACKUP',
        doc: doc.type,
        user: this.systemId,
        details: `Backup created by ${this.systemName}`
      });

      return { id: backupRef.key, ...docData };
    } catch (error) {
      console.error('Error creating backup:', error);
      throw new Error(`Failed to create backup: ${error.message}`);
    }
  }

  /**
   * Get all backups
   * @returns {Promise<Array>} - Array of backups
   */
  async getBackups() {
    try {
      const snapshot = await get(ref(this.db, 'backups'));
      if (!snapshot.exists()) return [];

      const backups = [];
      snapshot.forEach(child => {
        backups.push({
          id: child.key,
          ...child.val()
        });
      });

      return backups;
    } catch (error) {
      console.error('Error fetching backups:', error);
      throw new Error(`Failed to fetch backups: ${error.message}`);
    }
  }

  /**
   * Restore a document from backup
   * @param {string} backupId - Backup ID
   * @returns {Promise<Object>} - Restored document
   */
  async restoreFromBackup(backupId) {
    try {
      const snapshot = await get(ref(this.db, `backups/${backupId}`));
      if (!snapshot.exists()) throw new Error('Backup not found');

      const backup = snapshot.val();
      
      // Check if original document exists
      const existingDoc = await this.getDocumentById(backup.id);
      
      if (existingDoc) {
        // Restore existing document
        await this.updateDocument(backup.id, {
          deleted: false,
          status: backup.status,
          backed: false
        });
      } else {
        // Create new document from backup
        const newDocRef = push(ref(this.db, 'documents'));
        await set(newDocRef, {
          ...backup,
          deleted: false,
          backed: false,
          restoredAt: new Date().toISOString(),
          restoredBy: this.systemId
        });
      }

      // Remove from backups
      await remove(ref(this.db, `backups/${backupId}`));

      // Add audit log
      await this.addAuditLog({
        op: 'DOCUMENT_RESTORED',
        doc: backup.type,
        user: this.systemId,
        details: `Document restored from backup by ${this.systemName}`
      });

      return backup;
    } catch (error) {
      console.error('Error restoring from backup:', error);
      throw new Error(`Failed to restore from backup: ${error.message}`);
    }
  }

  /**
   * ============================================
   * AUDIT OPERATIONS
   * ============================================
   */

  /**
   * Add audit log entry
   * @param {Object} logData - Audit log data
   * @returns {Promise<Object>} - Created log entry
   */
  async addAuditLog(logData) {
    try {
      const logEntry = {
        ts: new Date().toISOString(),
        op: logData.op,
        doc: logData.doc,
        user: logData.user,
        ip: logData.ip || 'external-system',
        systemId: this.systemId,
        systemName: this.systemName,
        details: logData.details || ''
      };

      const logRef = push(ref(this.db, 'auditLog'));
      await set(logRef, logEntry);

      return { id: logRef.key, ...logEntry };
    } catch (error) {
      console.error('Error adding audit log:', error);
      // Don't throw - audit logging should not break main operations
      return null;
    }
  }

  /**
   * Get audit logs with filters
   * @param {Object} filters - Filter criteria
   * @returns {Promise<Array>} - Array of audit logs
   */
  async getAuditLogs(filters = {}) {
    try {
      const snapshot = await get(ref(this.db, 'auditLog'));
      if (!snapshot.exists()) return [];

      let logs = [];
      snapshot.forEach(child => {
        logs.push({
          id: child.key,
          ...child.val()
        });
      });

      // Apply filters
      if (filters.operation) {
        logs = logs.filter(log => log.op === filters.operation);
      }
      if (filters.user) {
        logs = logs.filter(log => log.user === filters.user);
      }
      if (filters.document) {
        logs = logs.filter(log => log.doc === filters.document);
      }
      if (filters.fromDate) {
        logs = logs.filter(log => new Date(log.ts) >= new Date(filters.fromDate));
      }
      if (filters.toDate) {
        logs = logs.filter(log => new Date(log.ts) <= new Date(filters.toDate));
      }

      // Sort by timestamp descending
      logs.sort((a, b) => new Date(b.ts) - new Date(a.ts));

      return logs;
    } catch (error) {
      console.error('Error fetching audit logs:', error);
      throw new Error(`Failed to fetch audit logs: ${error.message}`);
    }
  }

  /**
   * ============================================
   * STATISTICS & REPORTS
   * ============================================
   */

  /**
   * Get system statistics
   * @returns {Promise<Object>} - Statistics
   */
  async getStatistics() {
    try {
      const documents = await this.getDocuments();
      const activeDocs = documents.filter(d => !d.deleted);
      const backups = await this.getBackups();
      const auditLogs = await this.getAuditLogs();

      // Department statistics
      const departmentStats = {};
      activeDocs.forEach(doc => {
        if (!departmentStats[doc.type]) {
          departmentStats[doc.type] = {
            total: 0,
            active: 0,
            archived: 0,
            borrowed: 0
          };
        }
        departmentStats[doc.type].total++;
        if (doc.status === 'ACTIVE') departmentStats[doc.type].active++;
        else if (doc.status === 'ARCHIVED') departmentStats[doc.type].archived++;
        else if (doc.status === 'BORROWED') departmentStats[doc.type].borrowed++;
      });

      return {
        totalDocuments: activeDocs.length,
        activeDocuments: activeDocs.filter(d => d.status === 'ACTIVE').length,
        archivedDocuments: activeDocs.filter(d => d.status === 'ARCHIVED').length,
        borrowedDocuments: activeDocs.filter(d => d.status === 'BORROWED').length,
        totalBackups: backups.length,
        totalAuditEntries: auditLogs.length,
        departmentStats: departmentStats,
        lastUpdated: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error getting statistics:', error);
      throw new Error(`Failed to get statistics: ${error.message}`);
    }
  }

  /**
   * ============================================
   * BATCH OPERATIONS
   * ============================================
   */

  /**
   * Bulk create documents
   * @param {Array} documents - Array of document data
   * @returns {Promise<Array>} - Created documents
   */
  async bulkCreateDocuments(documents) {
    const results = [];
    for (const doc of documents) {
      try {
        const created = await this.createDocument(doc);
        results.push({ success: true, document: created });
      } catch (error) {
        results.push({ success: false, error: error.message, data: doc });
      }
    }
    return results;
  }

  /**
   * Bulk update documents
   * @param {Array} updates - Array of {id, updates} objects
   * @returns {Promise<Array>} - Update results
   */
  async bulkUpdateDocuments(updates) {
    const results = [];
    for (const { id, updates: docUpdates } of updates) {
      try {
        const updated = await this.updateDocument(id, docUpdates);
        results.push({ success: true, document: updated });
      } catch (error) {
        results.push({ success: false, error: error.message, id });
      }
    }
    return results;
  }
}

// Export the client
export default DocumentManagementClient;