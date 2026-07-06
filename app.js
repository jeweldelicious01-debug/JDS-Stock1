// app.js
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

const SESSION_KEY = 'restaurantStockSession_v1';
const colRef = (name) => collection(dbFs, name);

async function sha256(text) {
    const enc = new TextEncoder().encode(text);
    const hashBuf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const PALETTE = [
    { bg: '#eff6ff', border: '#3b82f6', text: '#1e40af' },
    { bg: '#fef2f2', border: '#ef4444', text: '#991b1b' },
    { bg: '#f0fdf4', border: '#22c55e', text: '#166534' },
    { bg: '#faf5ff', border: '#a855f7', text: '#6b21a8' },
];

async function seedIfEmpty() {
    try {
        const usersSnap = await getDocs(colRef('users'));
        if (!usersSnap.empty) return;

        const adminHash = await sha256('ChangeMe123!');
        await setDoc(doc(dbFs, 'users', 'admin-seed'), { username: 'admin', passwordHash: adminHash, role: 'admin' });
        
        const categories = [
            { key: 'dairy', name: 'Dairy', bg: '#eff6ff', border: '#3b82f6', text_color: '#1e40af' },
            { key: 'disposables', name: 'Disposables', bg: '#f9fafb', border: '#9ca3af', text_color: '#374151' }
        ];
        for (const cat of categories) {
            await setDoc(doc(dbFs, 'categories', cat.key), { name: cat.name, bg: cat.bg, border: cat.border, text_color: cat.text_color });
        }
    } catch (e) {
        console.warn("Seeding skipped or protected by Firestore database rules: ", e);
    }
}

// Explicitly register the factory globally for Alpine
window.stockApp = function() {
    return {
        // --- REACTIVE STORAGE DESKS ---
        categories: [],
        items: [],
        importantNotes: [],
        logs: [],
        users: [],
        
        ready: false,
        isAuthenticated: false,
        authChecking: true,
        currentRole: 'readonly',
        currentUsername: '',
        currentUserId: null,
        filterCat: 'all',
        
        loginForm: { username: '', password: '' },
        loginError: '',
        formInward: { itemId: '', qty: '' },
        formOutward: { itemId: '', department: 'Indian', qty: '' },
        formNote: { itemName: '', pax: '', dateLabel: '' },
        
        showNewItemModal: false,
        newItemForm: { name: '', categoryId: '', newCategoryName: '', threshold: 0 },
        showAccountModal: false,
        accountForm: { currentPassword: '', newPassword: '' },
        accountError: '',
        accountSuccess: '',
        showUserAdminModal: false,
        newUserForm: { username: '', password: '', role: 'inward' },
        newUserError: '',
        departments: ['Chinese', 'Indian', 'South Indian', 'Gujarati', 'Continental', 'Tandoor'],

        async init() {
            console.log("stockApp interface initialization firing...");
            await seedIfEmpty();
            
            // Real-time categories syncing
            onSnapshot(colRef('categories'), (snap) => { 
                this.categories = snap.docs.map((d) => ({ id: d.id, ...d.data() })); 
            });
            
            // Real-time items syncing
            onSnapshot(colRef('items'), (snap) => { 
                this.items = snap.docs.map((d) => ({ id: d.id, ...d.data() })); 
            });
            
            // Real-time event notes panels syncing
            onSnapshot(colRef('notes'), (snap) => { 
                this.importantNotes = snap.docs.map((d) => ({ id: d.id, ...d.data() })); 
            });
            
            // Real-time logging operations sync engine
            onSnapshot(colRef('logs'), (snap) => { 
                const rawLogs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
                this.logs = rawLogs
                    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                    .slice(0, 50)
                    .map((l) => {
                        const matchedItem = this.items.find((i) => String(i.id) === String(l.item_id));
                        return { ...l, item_name: matchedItem ? matchedItem.name : 'Unknown' };
                    });
            });
            
            // Real-time user session status tracking
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

        restoreSession() {
            const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
            if (session) {
                const user = this.users.find((u) => u.id === session.userId);
                if (user) {
                    this.currentUserId = user.id;
                    this.currentUsername = user.username;
                    this.currentRole = user.role;
                    this.isAuthenticated = true;
                }
            }
            this.authChecking = false;
        },

        get processedItems() {
            let dataset = this.items.map((i) => {
                const cat = this.categories.find((c) => c.id === i.category_id) || {};
                return { ...i, category_name: cat.name || 'Unassigned', bg: cat.bg || '#f3f4f6', border: cat.border || '#9ca3af', text_color: cat.text_color || '#374151' };
            });

            if (this.filterCat !== 'all') {
                dataset = dataset.filter((i) => i.category_name === this.filterCat);
            }
            return dataset.sort((a, b) => {
                let aAlert = a.stock <= a.threshold ? 1 : 0;
                let bAlert = b.stock <= b.threshold ? 1 : 0;
                if (aAlert !== bAlert) return bAlert - aAlert;
                return (a.order_index || 0) - (b.order_index || 0);
            });
        },

        async verifyLogin() {
            this.loginError = '';
            const { username, password } = this.loginForm;
            if (!username || !password) { this.loginError = 'Fields required'; return; }
            const user = this.users.find((u) => u.username.toLowerCase() === username.trim().toLowerCase());
            if (!user || (await sha256(password)) !== user.passwordHash) { this.loginError = 'Invalid credentials'; return; }
            this.currentUserId = user.id;
            this.currentUsername = user.username;
            this.currentRole = user.role;
            this.isAuthenticated = true;
            this.loginForm.password = '';
            sessionStorage.setItem(SESSION_KEY, JSON.stringify({ userId: user.id }));
        },

        logout() {
            sessionStorage.removeItem(SESSION_KEY);
            this.isAuthenticated = false;
            this.currentRole = 'readonly';
            this.currentUsername = '';
            this.currentUserId = null;
        },

        isWithinOneHour(timestamp) {
            if (!timestamp) return false;
            return Date.now() - new Date(timestamp).getTime() < 60 * 60 * 1000;
        },

        async submitNewNote() {
            if (!this.formNote.itemName || !this.formNote.pax || !this.formNote.dateLabel) return;
            await addDoc(colRef('notes'), { item_name: this.formNote.itemName.trim(), pax: parseInt(this.formNote.pax) || 0, date_label: this.formNote.dateLabel.trim() });
            this.formNote = { itemName: '', pax: '', dateLabel: '' };
        },

        async deleteNote(noteId) { await deleteDoc(doc(dbFs, 'notes', noteId)); },
        
        async changeItemName(item) {
            let updatedName = prompt('Enter item name:', item.name);
            if (updatedName?.trim()) await updateDoc(doc(dbFs, 'items', item.id), { name: updatedName.trim() });
        },
        
        async modifyThreshold(item) {
            let promptVal = prompt('Update safety limit:', item.threshold);
            if (promptVal !== null) await updateDoc(doc(dbFs, 'items', item.id), { threshold: parseInt(promptVal) || 0 });
        },
        
        async purgeItem(id) { if (confirm('Purge item entry?')) await deleteDoc(doc(dbFs, 'items', id)); },

        async shiftOrder(id, direction) {
            const sorted = [...this.items].sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
            const idx = sorted.findIndex((i) => i.id === id);
            if (idx === -1) return;
            const swapIdx = idx + (direction === 'up' ? -1 : 1);
            if (swapIdx < 0 || swapIdx >= sorted.length) return;
            await updateDoc(doc(dbFs, 'items', sorted[idx].id), { order_index: sorted[swapIdx].order_index || 0 });
            await updateDoc(doc(dbFs, 'items', sorted[swapIdx].id), { order_index: sorted[idx].order_index || 0 });
        },

        async submitNewItem() {
            if (!this.newItemForm.name.trim()) return;
            let categoryId = this.newItemForm.categoryId || null;
            if (!categoryId && this.newItemForm.newCategoryName.trim()) {
                const name = this.newItemForm.newCategoryName.trim();
                const existing = this.categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
                if (existing) categoryId = existing.id;
                else {
                    const palette = PALETTE[Math.floor(Math.random() * PALETTE.length)];
                    const newCatRef = await addDoc(colRef('categories'), { name, bg: palette.bg, border: palette.border, text_color: palette.text });
                    categoryId = newCatRef.id;
                }
            }
            if (!categoryId) return;
            const maxOrder = this.items.reduce((m, i) => Math.max(m, i.order_index || 0), 0);
            await addDoc(colRef('items'), { name: this.newItemForm.name.trim(), category_id: categoryId, stock: 0, threshold: this.newItemForm.threshold || 0, order_index: maxOrder + 1 });
            this.newItemForm = { name: '', categoryId: '', newCategoryName: '', threshold: 0 };
            this.showNewItemModal = false;
        },

        // --- ROCK SOLID INWARD METHOD ---
        async addInward() {
            if (!this.formInward.itemId || !this.formInward.qty) return alert('Select missing fields.');
            
            const target = this.items.find((i) => String(i.id) === String(this.formInward.itemId));
            if (!target) return alert('Selected item could not be found.');
            
            const qty = parseInt(this.formInward.qty);
            if (!qty || qty <= 0) return alert('Enter a positive quantity.');
            
            try {
                await updateDoc(doc(dbFs, 'items', target.id), { stock: Number(target.stock || 0) + qty });
                await addDoc(colRef('logs'), {
                    type: 'INWARD',
                    item_id: target.id,
                    qty,
                    department: null,
                    created_at: new Date().toISOString(),
                    created_by_name: this.currentUsername,
                });
                this.formInward = { itemId: '', qty: '' };
            } catch (error) {
                alert("Database write error: " + error.message);
            }
        },

        // --- ROCK SOLID OUTWARD METHOD ---
        async deductOutward() {
            if (!this.formOutward.itemId || !this.formOutward.qty) return alert('Select missing fields.');
            
            const target = this.items.find((i) => String(i.id) === String(this.formOutward.itemId));
            if (!target) return alert('Selected item could not be found.');
            
            const qty = parseInt(this.formOutward.qty);
            if (!qty || qty <= 0) return alert('Enter a positive quantity.');
            if (Number(target.stock || 0) < qty) return alert('Operation Denied: Insufficient stock balance.');
            
            try {
                await updateDoc(doc(dbFs, 'items', target.id), { stock: Number(target.stock) - qty });
                await addDoc(colRef('logs'), {
                    type: 'OUTWARD',
                    item_id: target.id,
                    qty,
                    department: this.formOutward.department,
                    created_at: new Date().toISOString(),
                    created_by_name: this.currentUsername,
                });
                this.formOutward = { itemId: '', department: 'Indian', qty: '' };
            } catch (error) {
                alert("Database write error: " + error.message);
            }
        },

        async triggerUndo(log) {
            const item = this.items.find((i) => String(i.id) === String(log.item_id));
            if (!item) return alert('The original tracking entry row no longer exists.');
            if (!this.isWithinOneHour(log.created_at)) return alert('Action window expired.');
            
            try {
                if (log.type === 'INWARD') {
                    await updateDoc(doc(dbFs, 'items', item.id), { stock: Math.max(0, Number(item.stock || 0) - Number(log.qty)) });
                } else {
                    await updateDoc(doc(dbFs, 'items', item.id), { stock: Number(item.stock || 0) + Number(log.qty) });
                }
                await deleteDoc(doc(dbFs, 'logs', log.id));
            } catch (error) {
                alert("Undo action failed: " + error.message);
            }
        },

        async changeMyPassword() {
            this.accountError = ''; this.accountSuccess = '';
            const { currentPassword, newPassword } = this.accountForm;
            if (newPassword.length < 6) { this.accountError = 'Min 6 characters'; return; }
            const user = this.users.find((u) => u.id === this.currentUserId);
            if ((await sha256(currentPassword)) !== user.passwordHash) { this.accountError = 'Incorrect current password'; return; }
            await updateDoc(doc(dbFs, 'users', user.id), { passwordHash: await sha256(newPassword) });
            this.accountSuccess = 'Password updated successfully.';
            this.accountForm = { currentPassword: '', newPassword: '' };
        },

        async createUser() {
            const { username, password, role } = this.newUserForm;
            if (!username || password.length < 6) return;
            await addDoc(colRef('users'), { username: username.trim(), passwordHash: await sha256(password), role });
            this.newUserForm = { username: '', password: '', role: 'inward' };
        },

        async changeUserRole(userId, role) { await updateDoc(doc(dbFs, 'users', userId), { role }); },
        async deleteUser(userId) { if (confirm('Permanently delete user?')) await deleteDoc(doc(dbFs, 'users', userId)); },

        downloadExcelReport() {
            const matrixData = [['ITEM NAME', 'CATEGORY', 'CURRENT STOCK', 'TOTAL INWARD']];
            this.processedItems.forEach((item) => {
                const itemLogs = this.logs.filter((l) => l.item_id === item.id);
                const totalIn = itemLogs.filter((l) => l.type === 'INWARD').reduce((acc, l) => acc + l.qty, 0);
                matrixData.push([item.name, item.category_name, item.stock, totalIn]);
            });
            const ws = XLSX.utils.aoa_to_sheet(matrixData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Stock Ledger');
            XLSX.writeFile(wb, `Stock_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
        }
    };
};
