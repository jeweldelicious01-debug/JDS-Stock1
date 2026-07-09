/**
 * Restaurant Stock Manager & Event Control Engine - Core Logic Module
 * Framework Bindings: Firebase Firestore SDK v10+, Alpine.js v3 Integration Engine
 * Architectural Profile: Enterprise Real-Time Cloud Synchronization Matrix
 */

import { dbFs } from './firebase-config.js'; 
import {
    collection,
    doc,
    getDocs,
    setDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

// Key constant utilized to safely partition separate local sessionStorage buckets
const SESSION_KEY = 'restaurantStockSession_v1';

/**
 * Utility Helper: Shorthand abstraction wrapper around Firestore's collection instantiation module
 * @param {string} name - Name target of the target Firestore database collection segment
 */
const colRef = (name) => collection(dbFs, name);

/**
 * Utility Cryptography Engine: Generates an asymmetrical SHA-256 string hash mapping signature
 * Used safely on client view environments for localized credential cross-verifications
 * @param {string} text - Plain text variable targeted for binary encryption hashing
 */
async function sha256(text) {
    const enc = new TextEncoder().encode(text);
    const hashBuf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Database Seeding Strategy Rule: Checks Firestore on boot and constructs initial master documents
 * Provisions fallbacks if standard data indices are completely blank or uninitialized
 */
async function seedIfEmpty() {
    try {
        // Step 1: Analyze user collection records
        const usersSnap = await getDocs(colRef('users'));
        if (usersSnap.empty) {
            const adminHash = await sha256('ChangeMe123!');
            await setDoc(doc(dbFs, 'users', 'admin-seed'), { username: 'admin', passwordHash: adminHash, role: 'admin' });
            await setDoc(doc(dbFs, 'users', 'order-seed'), { username: 'order', passwordHash: await sha256('Order123!'), role: 'order' });
            await setDoc(doc(dbFs, 'users', 'inward-seed'), { username: 'inward', passwordHash: await sha256('Inward123!'), role: 'inward' });
        }

        // Step 2: Establish the 13 foundational kitchen inventory tracking categories
        const catSnap = await getDocs(colRef('categories'));
        if (catSnap.size < 13) {
            const defaultCategories = [
                { id: 'kirana', name: 'Kirana', emoji: '🛒', bg_color: '#f8fafc', border_color: '#64748b', text_color: '#334151' },
                { id: 'frozen', name: 'Frozen', emoji: '❄️', bg_color: '#ecfeff', border_color: '#06b6d4', text_color: '#083344' },
                { id: 'masala', name: 'Masala', emoji: '🍛', bg_color: '#fff7ed', border_color: '#f97316', text_color: '#7c2d12' },
                { id: 'grain', name: 'Grain', emoji: '🌾', bg_color: '#fefce8', border_color: '#eab308', text_color: '#713f12' },
                { id: 'vegetables', name: 'Vegetables', emoji: '🥦', bg_color: '#f0fdf4', border_color: '#22c55e', text_color: '#14532d' },
                { id: 'bottle', name: 'Bottle', emoji: '🍾', bg_color: '#f5f5f4', border_color: '#737367', text_color: '#1c1917' },
                { id: 'pasta', name: 'Pasta', emoji: '🍝', bg_color: '#fffbeb', border_color: '#f59e0b', text_color: '#78350f' },
                { id: 'dairy', name: 'Dairy', emoji: '🥛', bg_color: '#eff6ff', border_color: '#3b82f6', text_color: '#1e40af' },
                { id: 'disposables', name: 'Disposables', emoji: '🥤', bg_color: '#fafafa', border_color: '#a3a3a3', text_color: '#171717' },
                { id: 'flour', name: 'Flour', emoji: '🥡', bg_color: '#fdf6f0', border_color: '#cca47c', text_color: '#4a3319' },
                { id: 'tin', name: 'Tin', emoji: '🥫', bg_color: '#f0fdfa', border_color: '#14b8a6', text_color: '#115e59' },
                { id: 'khademasala', name: 'KhadeMasala', emoji: '🌶️', bg_color: '#fff1f2', border_color: '#f43f5e', text_color: '#4c0519' },
                { id: 'beverages', name: 'Beverages', emoji: '🧃', bg_color: '#fdf2f8', border_color: '#ec4899', text_color: '#701a75' }
            ];
            for (const cat of defaultCategories) {
                await setDoc(doc(dbFs, 'categories', cat.id), { name: cat.name, emoji: cat.emoji, bg_color: cat.bg_color, border_color: cat.border_color, text_color: cat.text_color });
            }
        }

        // Step 3: Populate baseline structural vendor records
        const supSnap = await getDocs(colRef('suppliers'));
        if (supSnap.empty) {
            await addDoc(colRef('suppliers'), { name: 'Laxmi Traders', phone: '919999999999' });
            await addDoc(colRef('suppliers'), { name: 'Balaji Food Products', phone: '918888888888' });
        }
    } catch (e) {
        console.warn("Seeding initialization bypassed safely: ", e);
    }
}

/**
 * Master Alpine Component Constructor Object
 * Exposed via global window instance namespace layout architecture
 */
window.stockApp = function() {
    return {
        // --- REACTIVE ARRAY STORAGE REGISTRIES ---
        categories: [],
        items: [],
        importantNotes: [],
        logs: [],
        users: [],
        suppliers: [], 
        purchaseOrders: [], 
        
        // --- STRUCTURAL STATUS STATE TRACKERS ---
        ready: false,
        isAuthenticated: false,
        authChecking: true,
        currentRole: 'readonly',
        currentUsername: '',
        currentUserId: null,
        filterCat: 'all',
        orderViewTab: 'pending', // Toggles order desk state views: 'pending' | 'history'
        eventAlertMessage: '',   // Broadcast banner message vector tracking property
        
        // --- REAL-TIME DATA CAPTURE OBJECT BINDINGS ---
        loginForm: { username: '', password: '' },
        loginError: '',
        formInward: { itemId: '', qty: '', supplierName: '' }, 
        formOutward: { itemId: '', department: 'Indian', qty: '' },
        formNote: { itemName: '', pax: '', dateLabel: '' },
        
        // --- PURCHASE ORDER BASKET MATRIX ---
        orderDesk: {
            supplierId: '',
            selectedItemId: '',
            selectedQty: '',
            basket: [] 
        }, 
        
        // --- SESSION REVERSAL TRANSACTION TRACKERS (UNDO ENGINE) ---
        lastLogId: null,
        lastLogType: '', // Tracks transaction classification signatures: 'INWARD' | 'OUTWARD'
        
        // --- REACTIVE INTERFACE MODAL CONTROLLERS ---
        showNewItemModal: false,
        showAccountModal: false,
        showUserAdminModal: false,
        
        // --- DATA INGESTION BLUEPRINTS ---
        newItemForm: { name: '', categoryId: '', supplierName: '', threshold: 0, mrp: '' }, 
        newCategoryForm: { name: '', emoji: '📦', paletteIndex: 0 },
        
        // Static color configurations schema presets used when saving custom category styles
        paletteOptions: [
            { bg: '#eff6ff', border: '#3b82f6', text: '#1e40af' }, 
            { bg: '#fffbeb', border: '#f59e0b', text: '#92400e' }, 
            { bg: '#f0fdf4', border: '#22c55e', text: '#166534' }, 
            { bg: '#faf5ff', border: '#a855f7', text: '#6b21a8' }, 
            { bg: '#fdf2f8', border: '#ec4899', text: '#9d174d' },
            { bg: '#f8fafc', border: '#64748b', text: '#334151' }
        ],

        accountForm: { currentPassword: '', newPassword: '' },
        accountError: '',
        accountSuccess: '',
        newUserForm: { username: '', password: '', role: 'inward' },
        newUserError: '',
        departments: ['Chinese', 'Indian', 'South Indian', 'Gujarati', 'Continental', 'Tandoor'],

        /**
         * Initialize Component: Boots master cloud listeners on real-time channels
         */
        async init() {
            // Guarantee base seed layers exist in firestore collection indices
            await seedIfEmpty();
            
            // Register high-performance real-time query channel snapshots
            onSnapshot(colRef('categories'), (snap) => { this.categories = snap.docs.map((d) => ({ id: d.id, ...d.data() })); });
            onSnapshot(colRef('items'), (snap) => { this.items = snap.docs.map((d) => ({ id: d.id, ...d.data() })); });
            onSnapshot(colRef('suppliers'), (snap) => { this.suppliers = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a,b) => a.name.localeCompare(b.name)); });

            onSnapshot(colRef('purchase_orders'), (snap) => {
                this.purchaseOrders = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
                    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            });

            // Listens dynamically for Admin broadcast updates concerning major banquets
            onSnapshot(colRef('system_settings'), (snap) => {
                const docMatch = snap.docs.find(d => d.id === 'event_alert');
                if (docMatch) this.eventAlertMessage = docMatch.data().message || '';
            });
            
            onSnapshot(colRef('notes'), (snap) => { this.importantNotes = snap.docs.map((d) => ({ id: d.id, ...d.data() })); });
            onSnapshot(colRef('logs'), (snap) => { 
                const rawLogs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
                this.logs = rawLogs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 50).map((l) => {
                    const matchedItem = this.items.find((i) => String(i.id) === String(l.item_id));
                    return { ...l, item_name: matchedItem ? matchedItem.name : 'Unknown' };
                });
            });

            // Evaluates platform operator state and fires session check triggers upon loading sequence completion
            onSnapshot(colRef('users'), (snap) => {
                this.users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
                if (this.currentUserId) {
                    const me = this.users.find((u) => u.id === this.currentUserId);
                    if (!me) this.logout();
                    else { this.currentRole = me.role; this.currentUsername = me.username; }
                }
                if (!this.ready) { this.ready = true; this.restoreSession(); }
            });
        },

        /**
         * Session Security Controller: Cross-checks browser tokens against memory scopes
         */
        restoreSession() {
            const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
            if (session) {
                const user = this.users.find((u) => u.id === session.userId);
                if (user) {
                    this.currentUserId = user.id; this.currentUsername = user.username; this.currentRole = user.role; this.isAuthenticated = true;
                }
            }
            this.authChecking = false;
        },

        /**
         * Computed Data Getter: Computes sorting patterns, applies category filters,
         * and bubbles warning breaches straight to the top of the workspace dashboard data table grid view.
         */
        get processedItems() {
            let dataset = this.items.map((i) => {
                const cat = this.categories.find((c) => c.id === i.category_id) || {};
                return { ...i, category_name: cat.name || 'Unassigned', emoji: cat.emoji || '📦', bg: cat.bg_color || '#f3f4f6', border: cat.border_color || '#9ca3af', text_color: cat.text_color || '#374151' };
            });
            if (this.filterCat !== 'all') dataset = dataset.filter((i) => i.category_name === this.filterCat);
            return dataset.sort((a, b) => {
                let aAlert = a.stock <= a.threshold ? 1 : 0; let bAlert = b.stock <= b.threshold ? 1 : 0;
                if (aAlert !== bAlert) return bAlert - aAlert;
                return (a.order_index || 0) - (b.order_index || 0);
            });
        },

        /**
         * Cascading Dropdown Filter 1: Returns items belonging to the selected inward supplier.
         * Resolves fallback options if legacy items don't have explicit supplier keys attached.
         */
        get filteredInwardItems() {
            if (!this.formInward.supplierName) return [];
            const defaultSupplier = this.suppliers[0] ? this.suppliers[0].name : '';
            return this.items.filter(i => {
                const itemSupplier = i.supplier_name || defaultSupplier;
                return itemSupplier === this.formInward.supplierName;
            });
        },

        /**
         * Cascading Dropdown Filter 2: Returns items matching the target vendor chosen inside procurement panels.
         */
        get filteredOrderDeskItems() {
            if (!this.orderDesk.supplierId) return [];
            const vendor = this.suppliers.find(s => String(s.id) === String(this.orderDesk.supplierId));
            if (!vendor) return [];
            const defaultSupplier = this.suppliers[0] ? this.suppliers[0].name : '';
            return this.items.filter(i => {
                const itemSupplier = i.supplier_name || defaultSupplier;
                return itemSupplier === vendor.name;
            });
        },

        /**
         * Computed Order Tracker Split: Automatically partitions active pending orders from completed transactions.
         */
        get processedPurchaseOrders() {
            if (this.orderViewTab === 'pending') {
                return this.purchaseOrders.filter(o => o.status === 'PENDING');
            } else {
                return this.purchaseOrders.filter(o => o.status !== 'PENDING');
            }
        },

        /**
         * Procurement Handler: Validates and appends item draft rows onto localized request basket arrays
         */
        addItemToOrder() {
            if (!this.orderDesk.selectedItemId || !this.orderDesk.selectedQty) return alert("Select an item and input quantity.");
            const targetItem = this.items.find(i => String(i.id) === String(this.orderDesk.selectedItemId));
            if (!targetItem) return;

            this.orderDesk.basket.push({
                id: targetItem.id,
                name: targetItem.name,
                qty: parseInt(this.orderDesk.selectedQty) || 1
            });
            this.orderDesk.selectedItemId = '';
            this.orderDesk.selectedQty = '';
        },

        /**
         * Procurement Handler: Splices item indexes out of current draft order array collections
         */
        removeOrderBasketItem(index) { this.orderDesk.basket.splice(index, 1); },

        /**
         * Integration Engine API: Saves the pending purchase order to the database, converts layout arrays 
         * into markdown text blocks, and launches an external automated WhatsApp transmission thread window.
         */
        async sendWhatsAppOrder() {
            if (!this.orderDesk.supplierId || !this.orderDesk.basket.length) return alert("Supplier choice or draft basket is empty.");
            const vendor = this.suppliers.find(s => String(s.id) === String(this.orderDesk.supplierId));
            if (!vendor) return;

            try {
                // Step 1: Write tracking row to cloud to guarantee visibility logs can map it later
                await addDoc(colRef('purchase_orders'), {
                    supplier_name: vendor.name,
                    items: this.orderDesk.basket,
                    status: 'PENDING',
                    created_at: new Date().toISOString(),
                    created_by: this.currentUsername
                });

                // Step 2: Formulate plain markdown structural format for suppliers
                let textMessage = `📋 *PURCHASE ORDER: ${vendor.name.toUpperCase()}*\n`;
                textMessage += `Date: ${new Date().toLocaleDateString('en-GB')}\n`;
                textMessage += `------------------------------------\n`;
                this.orderDesk.basket.forEach((item, index) => {
                    textMessage += `${index + 1}. *${item.name}* — Qty: ${item.qty}\n`;
                });
                textMessage += `------------------------------------\n`;
                textMessage += `Please fulfill this request at your earliest availability. Thank you!`;

                const urlSafeMessage = encodeURIComponent(textMessage);
                const targetPhone = vendor.phone ? vendor.phone.replace(/\D/g, '') : '';
                window.open(`https://wa.me/${targetPhone}?text=${urlSafeMessage}`, '_blank');

                this.orderDesk.basket = [];
                this.orderDesk.supplierId = '';
            } catch (e) {
                alert("Error staging order tracking row: " + e.message);
            }
        },

        /**
         * Inward Verification System: Processes arrived delivery orders. Supports modifying input quantities 
         * to handle partial deliveries, automatically calculating differences, updating warehouse balances, 
         * and marking history states as RECEIVED, PARTIAL, or DECLINED cleanly.
         */
        async approveIncomingOrder(order) {
            if (order.status !== 'PENDING') return;
            if (!confirm(`Confirm stock ingestion from ${order.supplier_name}? Live balances will update based on the quantities listed below.`)) return;

            try {
                let hasMissingItems = false;
                let hasReceivedItems = false;

                for (let record of order.items) {
                    const arrivedQty = parseInt(record.qty) || 0;
                    if (arrivedQty < 0) return alert("Quantities cannot be negative numbers.");
                    if (arrivedQty === 0) hasMissingItems = true;

                    const targetItem = this.items.find(i => String(i.id) === String(record.id));
                    if (targetItem && arrivedQty > 0) {
                        hasReceivedItems = true;
                        // Mutation Transaction: Commit physical count updates straight to live cloud storage balance properties
                        await updateDoc(doc(dbFs, 'items', targetItem.id), { stock: Number(targetItem.stock || 0) + arrivedQty });
                        await addDoc(colRef('logs'), { type: 'INWARD', item_id: targetItem.id, qty: arrivedQty, supplier_name: order.supplier_name, department: null, created_at: new Date().toISOString(), created_by_name: this.currentUsername });
                    }
                }

                // Conditional Evaluation: Flags structural archival statuses based on delivery accuracy outcomes
                let finalStatus = 'RECEIVED';
                if (hasMissingItems && hasReceivedItems) finalStatus = 'PARTIAL';
                else if (!hasReceivedItems) finalStatus = 'DECLINED';

                await updateDoc(doc(dbFs, 'purchase_orders', order.id), { status: finalStatus, items: order.items, resolved_at: new Date().toISOString(), resolved_by: this.currentUsername });
                alert(`Order marked as [${finalStatus}]. Balances synchronized cleanly.`);
            } catch (error) { alert("Approval processing error: " + error.message); }
        },

        /**
         * Inward Verification System: Rejects a pending consignment entirely, moving it out of the active log desk views
         */
        async declineIncomingOrder(order) {
            if (order.status !== 'PENDING') return;
            if (!confirm(`Are you sure you want to DECLINE and cancel this order from ${order.supplier_name}?`)) return;
            try {
                await updateDoc(doc(dbFs, 'purchase_orders', order.id), { status: 'DECLINED', resolved_at: new Date().toISOString(), resolved_by: this.currentUsername });
                alert("Order successfully canceled and marked as DECLINED.");
            } catch (error) { alert("Error canceling order: " + error.message); }
        },

        /**
         * Broadcast Controller: Publishes major event banners globally to coordinate high-volume requirements across all logging stations.
         */
        async setBigFunctionEventAlert() {
            let promptMsg = prompt("Enter Big Function Event Alert parameters (or leave totally blank to wipe alert banner):", this.eventAlertMessage);
            if (promptMsg === null) return;
            try {
                await setDoc(doc(dbFs, 'system_settings', 'event_alert'), {
                    message: promptMsg.trim(),
                    updated_at: new Date().toISOString(),
                    updated_by: this.currentUsername
                });
                alert("Global Big Function Notification state successfully distributed.");
            } catch (e) { alert("Write access failed: " + e.message); }
        },

        /**
         * Authentication Controller: Intercepts logins, validates passwords against cryptographically hashed hashes,
         * and mounts fresh data state views inside localized session caches.
         */
        async verifyLogin() {
            this.loginError = '';
            const { username, password } = this.loginForm;
            if (!username || !password) { this.loginError = 'Fields required'; return; }
            const user = this.users.find((u) => u.username.toLowerCase() === username.trim().toLowerCase());
            if (!user || (await sha256(password)) !== user.passwordHash) { this.loginError = 'Invalid credentials'; return; }
            this.currentUserId = user.id; this.currentUsername = user.username; this.currentRole = user.role; this.isAuthenticated = true;
            this.loginForm.password = '';
            sessionStorage.setItem(SESSION_KEY, JSON.stringify({ userId: user.id }));
        },

        /**
         * Authentication Controller: Flushes browser session states and reduces user authorization roles to Read-Only
         */
        logout() { sessionStorage.removeItem(SESSION_KEY); this.isAuthenticated = false; this.currentRole = 'readonly'; this.currentUsername = ''; this.currentUserId = null; },
        async deleteNote(noteId) { await deleteDoc(doc(dbFs, 'notes', noteId)); },
        
        /**
         * Asset Manager Prompt: Standard configuration wizard sequence. Updates product descriptions,
         * links items to custom suppliers via simple coded listings, and edits MRP values in single operational runs.
         */
        async changeItemName(item) {
            let updatedName = prompt(`[1/3] Update Name for "${item.name}":`, item.name);
            if (updatedName === null) return;
            if (!updatedName.trim()) return alert("Item Name cannot be empty.");

            let catList = this.suppliers.map((s, idx) => `${idx + 1}. ${s.name}`).join('\n');
            let vendorChoice = prompt(`[2/3] Choose Supplier Number for "${updatedName.trim()}":\n\n${catList}\n\nOr type "NEW" to provision a fresh vendor registry directly.`);
            if (vendorChoice === null) return;

            let finalVendor = item.supplier_name || (this.suppliers[0] ? this.suppliers[0].name : 'General Vendor');
            if (vendorChoice.trim().toUpperCase() === "NEW") {
                let freshName = prompt("Enter Fresh Supplier Label:");
                if (freshName?.trim()) {
                    finalVendor = freshName.trim();
                    const matchEx = this.suppliers.find(s => s.name.toLowerCase() === finalVendor.toLowerCase());
                    if (!matchEx) await addDoc(colRef('suppliers'), { name: finalVendor, phone: '' });
                }
            } else if (vendorChoice.trim() !== "") {
                let sIdx = parseInt(vendorChoice) - 1;
                if (sIdx >= 0 && sIdx < this.suppliers.length) finalVendor = this.suppliers[sIdx].name;
            }

            let promptPrice = prompt(`[3/3] Update Unit Price (MRP) for "${updatedName.trim()}":`, item.mrp || 0);
            if (promptPrice === null) return;
            let finalPrice = Number(promptPrice);
            if (isNaN(finalPrice) || finalPrice < 0) return alert("Enter valid numerical amount.");

            try {
                await updateDoc(doc(dbFs, 'items', item.id), { name: updatedName.trim(), supplier_name: finalVendor, mrp: finalPrice });
                alert("Matrix attributes successfully configured.");
            } catch (e) { alert(e.message); }
        },

        async modifyThreshold(item) {
            let promptVal = prompt('Update safety limit:', item.threshold);
            if (promptVal !== null) await updateDoc(doc(dbFs, 'items', item.id), { threshold: parseInt(promptVal) || 0 });
        },
        async purgeItem(id) { if (confirm('Purge item entry?')) await deleteDoc(doc(dbFs, 'items', id)); },
        
        /**
         * Re-ordering Sorting Utility: Shifts display parameters and adjusts index sorting weights across Firestore sheets
         */
        async shiftOrder(id, direction) {
            const sorted = [...this.items].sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
            const idx = sorted.findIndex((i) => i.id === id); if (idx === -1) return;
            const swapIdx = idx + (direction === 'up' ? -1 : 1); if (swapIdx < 0 || swapIdx >= sorted.length) return;
            await updateDoc(doc(dbFs, 'items', sorted[idx].id), { order_index: sorted[swapIdx].order_index || 0 });
            await updateDoc(doc(dbFs, 'items', sorted[swapIdx].id), { order_index: sorted[idx].order_index || 0 });
        },

        /**
         * Portfolio Handler: Saves new physical item lines into localized stock tracking structures
         */
        async submitNewItem() {
            if (!this.newItemForm.name.trim() || !this.newItemForm.categoryId || !this.newItemForm.supplierName) return alert("Please map all tags.");
            const maxOrder = this.items.reduce((m, i) => Math.max(m, i.order_index || 0), 0);
            await addDoc(colRef('items'), { name: this.newItemForm.name.trim(), category_id: this.newItemForm.categoryId, supplier_name: this.newItemForm.supplierName, stock: 0, threshold: this.newItemForm.threshold || 0, mrp: Number(this.newItemForm.mrp || 0), order_index: maxOrder + 1 });
            this.newItemForm = { name: '', categoryId: '', supplierName: '', threshold: 0, mrp: '' };
            this.showNewItemModal = false;
        },

        /**
         * Portfolio Customizer Method: Builds entirely custom category blocks dynamically from client views.
         * Generates text badge style maps matching selected visual color options and saves them live.
         */
        async submitNewCategory() {
            if (!this.newCategoryForm.name.trim() || !this.newCategoryForm.emoji.trim()) return alert("Fields required.");
            const standardizedId = this.newCategoryForm.name.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!standardizedId) return alert("Invalid layout name.");
            if (this.categories.find(c => c.id === standardizedId)) return alert("Category already exists.");
            const chosenPalette = this.paletteOptions[this.newCategoryForm.paletteIndex || 0];
            try {
                await setDoc(doc(dbFs, 'categories', standardizedId), { name: this.newCategoryForm.name.trim(), emoji: this.newCategoryForm.emoji.trim(), bg_color: chosenPalette.bg, border_color: chosenPalette.border, text_color: chosenPalette.text });
                alert(`📁 Category Matrix "${this.newCategoryForm.name.trim()}" successfully deployed live!`);
                this.newCategoryForm = { name: '', emoji: '📦', paletteIndex: 0 };
            } catch (err) { alert(err.message); }
        },

        /**
         * Bulk Data Parser Engine: Deconstructs raw CSV matrices and updates cloud entities sequentially
         */
        async handleCsvUpload(event) {
            const file = event.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = async (e) => {
                const text = e.target.result; const lines = text.split('\n');
                for (let i = 1; i < lines.length; i++) {
                    if (!lines[i].trim()) continue;
                    const columns = lines[i].split(',');
                    if (columns.length >= 4) {
                        const name = columns[0].trim(); const categoryName = columns[1].trim(); const qty = parseInt(columns[2]) || 0; const threshold = parseInt(columns[3]) || 0; const mrp = columns[4] ? Number(columns[4].trim()) || 0 : 0;
                        let cat = this.categories.find((c) => c.name.toLowerCase() === categoryName.toLowerCase());
                        let categoryId = cat ? cat.id : (await addDoc(colRef('categories'), { name: categoryName, emoji: '🍱', bg_color: '#f3f4f6', border_color: '#9ca3af', text_color: '#374151' })).id;
                        const existingItem = this.items.find((it) => it.name.toLowerCase() === name.toLowerCase());
                        if (existingItem) await updateDoc(doc(dbFs, 'items', existingItem.id), { stock: existingItem.stock + qty, threshold, mrp });
                        else {
                            const maxOrder = this.items.reduce((m, it) => Math.max(m, it.order_index || 0), 0);
                            await addDoc(colRef('items'), { name, category_id: categoryId, supplier_name: 'General Vendor', stock: qty, threshold, mrp, order_index: maxOrder + 1 });
                        }
                    }
                }
                alert("CSV Ingested."); event.target.value = '';
            };
            reader.readAsText(file);
        },

        /**
         * Manual Logger Axis (Inward): Updates individual inventory quantities manually.
         * Saves transaction reference pointers locally to enable quick session rollbacks.
         */
        async addInward() {
            if (!this.formInward.itemId || !this.formInward.qty || !this.formInward.supplierName) return alert('Select missing fields.');
            const target = this.items.find((i) => String(i.id) === String(this.formInward.itemId)); if (!target) return alert('Selected item could not be found.');
            const qty = parseInt(this.formInward.qty); if (!qty || qty <= 0) return alert('Enter a positive quantity.');
            let vendor = this.formInward.supplierName.trim();
            if (vendor === "_NEW_") {
                let newVendorName = prompt("Enter new Supplier Name:"); if (!newVendorName || !newVendorName.trim()) return alert("Supplier name required.");
                vendor = newVendorName.trim();
                const matchEx = this.suppliers.find(s => s.name.toLowerCase() === vendor.toLowerCase());
                if (!matchEx) await addDoc(colRef('suppliers'), { name: vendor, phone: '' });
            }
            try {
                await updateDoc(doc(dbFs, 'items', target.id), { stock: Number(target.stock || 0) + qty });
                const docRef = await addDoc(colRef('logs'), { type: 'INWARD', item_id: target.id, qty, supplier_name: vendor, department: null, created_at: new Date().toISOString(), created_by_name: this.currentUsername });
                this.lastLogId = docRef.id; this.lastLogType = 'INWARD'; // Assign references to feed localized undo buttons
                this.formInward = { itemId: '', qty: '', supplierName: '' };
            } catch (error) { alert("Database write error: " + error.message); }
        },

        /**
         * Manual Logger Axis (Outward): Records internal stock distributions and line allocation deductions
         */
        async deductOutward() {
            if (!this.formOutward.itemId || !this.formOutward.qty) return alert('Select missing fields.');
            const target = this.items.find((i) => String(i.id) === String(this.formOutward.itemId)); if (!target) return alert('Item not found.');
            const qty = parseInt(this.formOutward.qty); if (!qty || qty <= 0) return alert('Enter positive quantity.');
            if (Number(target.stock || 0) < qty) return alert('Insufficient stock.');
            try {
                await updateDoc(doc(dbFs, 'items', target.id), { stock: Number(target.stock) - qty });
                const docRef = await addDoc(colRef('logs'), { type: 'OUTWARD', item_id: target.id, qty, department: this.formOutward.department, created_at: new Date().toISOString(), created_by_name: this.currentUsername });
                this.lastLogId = docRef.id; this.lastLogType = 'OUTWARD'; // Assign references to feed localized undo buttons
                this.formOutward = { itemId: '', department: 'Indian', qty: '' };
            } catch (error) { alert("Error: " + error.message); }
        },

        /**
         * Reversal Component Logic (Undo / Redo): Looks up the most recent session operation log ID,
         * performs the inverse calculation on the asset row, and safely deletes the invalid log record from the cloud.
         */
        async undoLastTransaction() {
            if (!this.lastLogId) return alert("No recent log found.");
            if (!confirm(`Are you sure you want to REVERT your last ${this.lastLogType} entry?`)) return;
            try {
                const logsSnap = await getDocs(colRef('logs'));
                const targetingLog = logsSnap.docs.find(d => d.id === this.lastLogId);
                if (!targetingLog) { this.lastLogId = null; return; }
                const logData = targetingLog.data();
                const targetItem = this.items.find(i => String(i.id) === String(logData.item_id));
                if (!targetItem) return;
                let balanceCorrection = logData.type === 'INWARD' ? Number(targetItem.stock || 0) - parseInt(logData.qty) : Number(targetItem.stock || 0) + parseInt(logData.qty);
                if (balanceCorrection < 0) return alert("Rollback denied.");
                await updateDoc(doc(dbFs, 'items', targetItem.id), { stock: balanceCorrection });
                await deleteDoc(doc(dbFs, 'logs', this.lastLogId));
                alert(`Rolled back successfully for "${targetItem.name}".`);
                this.lastLogId = null; this.lastLogType = '';
            } catch (e) { alert(e.message); }
        },

        async changeUserRole(userId, role) { await updateDoc(doc(dbFs, 'users', userId), { role }); },
        async deleteUser(userId) { if (confirm('Delete user?')) await deleteDoc(doc(dbFs, 'users', userId)); },
        
        async changeMyPassword() {
            this.accountError = ''; this.accountSuccess = '';
            const { currentPassword, newPassword } = this.accountForm;
            if (newPassword.length < 6) { this.accountError = 'Min 6 characters'; return; }
            const user = this.users.find((u) => u.id === this.currentUserId);
            if ((await sha256(currentPassword)) !== user.passwordHash) { this.accountError = 'Incorrect password'; return; }
            await updateDoc(doc(dbFs, 'users', user.id), { passwordHash: await sha256(newPassword) });
            this.accountSuccess = 'Password updated.';
            this.accountForm = { currentPassword: '', newPassword: '' };
        },

        createUser() {
            const { username, password, role = 'inward' } = this.newUserForm;
            if (!username || password.length < 6) return;
            addDoc(colRef('users'), { username: username.trim(), passwordHash: sha256(password), role });
            this.newUserForm = { username: '', password: '', role: 'inward' };
        },
        async promptResetPassword(user) {
            let newPass = prompt(`Enter new password (Min 6 chars):`);
            if (!newPass || newPass.trim().length < 6) return;
            try {
                await updateDoc(doc(dbFs, 'users', user.id), { passwordHash: await sha256(newPass.trim()) });
                alert("Password updated!");
            } catch (error) { alert(error.message); }
        },

        /**
         * Financial Audit Tool: Regroups historical transaction rows by vendor name properties
         * and writes complete accounting tables cleanly into structured .xlsx spread documents.
         */
        downloadInwardSupplierReport() {
            const inwards = this.logs.filter(l => l.type === 'INWARD'); if (!inwards.length) return alert("No inward data.");
            const supplierGroups = {};
            inwards.forEach(log => {
                const sName = log.supplier_name || 'Historical Vendor';
                if (!supplierGroups[sName]) supplierGroups[sName] = []; supplierGroups[sName].push(log);
            });
            const sheetMatrix = [];
            Object.keys(supplierGroups).forEach(supplier => {
                sheetMatrix.push([`Supplier: ${supplier.toUpperCase()}`]); sheetMatrix.push(["ITEM NAME", "QUANTITY RECEIVED", "UNIT PRICE", "TOTAL VALUATION"]);
                let grandTotal = 0;
                supplierGroups[supplier].forEach(log => {
                    const linkedItem = this.items.find(i => String(i.id) === String(log.item_id)) || {};
                    const name = log.item_name || linkedItem.name; const qty = parseInt(log.qty) || 0; const price = parseFloat(linkedItem.mrp) || 0; const totalCost = qty * price; grandTotal += totalCost;
                    sheetMatrix.push([name, qty, `₹${price}`, `₹${totalCost}`]);
                });
                sheetMatrix.push(["", "", "GRAND TOTAL:", `₹${grandTotal}`]); sheetMatrix.push([]); 
            });
            const ws = XLSX.utils.aoa_to_sheet(sheetMatrix); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Supplier Inward Breakdown");
            XLSX.writeFile(wb, `Supplier_Inward_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
        },

        /**
         * Management Dashboard Report: Compiles stock histories from the last 30 days into 
         * spreadsheet matrices, tracking inward entries and outward allocations by department names.
         */
        downloadExcelReport() {
            const getLocalDateString = (offsetDays) => { const d = new Date(); d.setDate(d.getDate() - offsetDays); return d.toISOString().slice(0, 10); };
            const formatHeaderLabel = (dateStr) => { const parts = dateStr.split('-'); if (parts.length !== 3) return dateStr; const dateObj = new Date(parts[0], parts[1] - 1, parts[2]); return dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).replace(' ', ''); };
            const targetDays = []; for (let i = 0; i < 30; i++) targetDays.push(getLocalDateString(i));
            const headerRow = ["DATE", "TOTAL STOCK"]; targetDays.forEach(dateStr => { const dayLabel = formatHeaderLabel(dateStr); headerRow.push(`${dayLabel}IN`); headerRow.push(`${dayLabel}OUT`); });
            const matrixData = [headerRow, ["ITEM NAME"]];
            this.processedItems.forEach(item => {
                const row = [item.name, item.stock];
                targetDays.forEach(targetDate => {
                    let dayInwards = this.logs.filter(l => l.created_at && String(l.item_id) === String(item.id) && l.type === 'INWARD' && l.created_at.slice(0, 10) === targetDate);
                    row.push(dayInwards.length ? `+${dayInwards.reduce((sum, l) => sum + (parseInt(l.qty) || 0), 0)}` : "0");
                    let dayOutwards = this.logs.filter(l => l.created_at && String(l.item_id) === String(item.id) && l.type === 'OUTWARD' && l.created_at.slice(0, 10) === targetDate);
                    if (dayOutwards.length) { row.push(dayOutwards.map(l => `-${l.qty} (${l.department || 'General'})`).join("\n")); } else { row.push("0"); }
                });
                matrixData.push(row);
            });
            const ws = XLSX.utils.aoa_to_sheet(matrixData); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "30-Day LIFO Ledger");
            const colWidths = [{wch: 24}, {wch: 14}]; for (let i = 0; i < 60; i++) colWidths.push({ wch: i % 2 === 0 ? 14 : 26 });
            ws['!cols'] = colWidths; XLSX.writeFile(wb, `Stock_Rolling_Report_${getLocalDateString(0)}.xlsx`);
        }
    };
};

// --- INITIALIZATION INTERCEPT SYNC LAYERS ---
// Synchronizes modular scripts with DOM lifecycles to prevent timing issues when using deferred loaders
document.addEventListener('DOMContentLoaded', () => {
    if (window.Alpine) { window.Alpine.data('stockApp', window.stockApp); } 
    else { document.addEventListener('alpine:init', () => { window.Alpine.data('stockApp', window.stockApp); }); }
});
