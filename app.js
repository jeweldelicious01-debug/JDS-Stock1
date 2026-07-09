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
    { bg: '#fffbeb', border: '#f59e0b', text: '#92400e' }, 
    { bg: '#f0fdf4', border: '#22c55e', text: '#166534' }, 
    { bg: '#faf5ff', border: '#a855f7', text: '#6b21a8' }, 
    { bg: '#fdf2f8', border: '#ec4899', text: '#9d174d' }, 
];

async function seedIfEmpty() {
    try {
        const usersSnap = await getDocs(colRef('users'));
        if (usersSnap.empty) {
            const adminHash = await sha256('ChangeMe123!');
            await setDoc(doc(dbFs, 'users', 'admin-seed'), { username: 'admin', passwordHash: adminHash, role: 'admin' });
            await setDoc(doc(dbFs, 'users', 'order-seed'), { username: 'order', passwordHash: await sha256('Order123!'), role: 'order' });
            await setDoc(doc(dbFs, 'users', 'inward-seed'), { username: 'inward', passwordHash: await sha256('Inward123!'), role: 'inward' });
        }

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

        const supSnap = await getDocs(colRef('suppliers'));
        if (supSnap.empty) {
            await addDoc(colRef('suppliers'), { name: 'Laxmi Traders', phone: '919999999999' });
            await addDoc(colRef('suppliers'), { name: 'Balaji Food Products', phone: '918888888888' });
        }
    } catch (e) {
        console.warn("Seeding bypassed: ", e);
    }
}

window.stockApp = function() {
    return {
        categories: [],
        items: [],
        importantNotes: [],
        logs: [],
        users: [],
        suppliers: [], 
        purchaseOrders: [], 
        
        ready: false,
        isAuthenticated: false,
        authChecking: true,
        currentRole: 'readonly',
        currentUsername: '',
        currentUserId: null,
        filterCat: 'all',
        
        loginForm: { username: '', password: '' },
        loginError: '',
        formInward: { itemId: '', qty: '', supplierName: '' }, 
        formOutward: { itemId: '', department: 'Indian', qty: '' },
        formNote: { itemName: '', pax: '', dateLabel: '' },
        
        orderDesk: {
            supplierId: '',
            selectedItemId: '',
            selectedQty: '',
            basket: [] 
        }, 
        
        showNewItemModal: false,
        showAccountModal: false,
        showUserAdminModal: false,
        
        newItemForm: { name: '', categoryId: '', supplierName: '', threshold: 0, mrp: '' }, 
        accountForm: { currentPassword: '', newPassword: '' },
        accountError: '',
        accountSuccess: '',
        newUserForm: { username: '', password: '', role: 'inward' },
        newUserError: '',
        departments: ['Chinese', 'Indian', 'South Indian', 'Gujarati', 'Continental', 'Tandoor'],

        async init() {
            await seedIfEmpty();
            
            onSnapshot(colRef('categories'), (snap) => { this.categories = snap.docs.map((d) => ({ id: d.id, ...d.data() })); });
            onSnapshot(colRef('items'), (snap) => { this.items = snap.docs.map((d) => ({ id: d.id, ...d.data() })); });
            
            onSnapshot(colRef('suppliers'), (snap) => {
                this.suppliers = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a,b) => a.name.localeCompare(b.name));
            });

            onSnapshot(colRef('purchase_orders'), (snap) => {
                this.purchaseOrders = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
                    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            });
            
            onSnapshot(colRef('notes'), (snap) => { this.importantNotes = snap.docs.map((d) => ({ id: d.id, ...d.data() })); });
            onSnapshot(colRef('logs'), (snap) => { 
                const rawLogs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
                this.logs = rawLogs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 50).map((l) => {
                    const matchedItem = this.items.find((i) => String(i.id) === String(l.item_id));
                    return { ...l, item_name: matchedItem ? matchedItem.name : 'Unknown' };
                });
            });
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
                    this.currentUserId = user.id; this.currentUsername = user.username; this.currentRole = user.role; this.isAuthenticated = true;
                }
            }
            this.authChecking = false;
        },

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

        get filteredInwardItems() {
            if (!this.formInward.supplierName) return [];
            const defaultSupplier = this.suppliers[0] ? this.suppliers[0].name : '';
            return this.items.filter(i => {
                const itemSupplier = i.supplier_name || defaultSupplier;
                return itemSupplier === this.formInward.supplierName;
            });
        },

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

        removeOrderBasketItem(index) { this.orderDesk.basket.splice(index, 1); },

        async sendWhatsAppOrder() {
            if (!this.orderDesk.supplierId || !this.orderDesk.basket.length) return alert("Supplier choice or draft basket is empty.");
            const vendor = this.suppliers.find(s => String(s.id) === String(this.orderDesk.supplierId));
            if (!vendor) return;

            try {
                await addDoc(colRef('purchase_orders'), {
                    supplier_name: vendor.name,
                    items: this.orderDesk.basket,
                    status: 'PENDING',
                    created_at: new Date().toISOString(),
                    created_by: this.currentUsername
                });

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

        async approveIncomingOrder(order) {
            if (order.status !== 'PENDING') return;
            if (!confirm(`Approve incoming stock items from ${order.supplier_name}?`)) return;

            try {
                for (let record of order.items) {
                    const targetItem = this.items.find(i => String(i.id) === String(record.id));
                    if (targetItem) {
                        await updateDoc(doc(dbFs, 'items', targetItem.id), {
                            stock: Number(targetItem.stock || 0) + parseInt(record.qty)
                        });

                        await addDoc(colRef('logs'), {
                            type: 'INWARD',
                            item_id: targetItem.id,
                            qty: parseInt(record.qty),
                            supplier_name: order.supplier_name,
                            department: null,
                            created_at: new Date().toISOString(),
                            created_by_name: this.currentUsername
                        });
                    }
                }

                await updateDoc(doc(dbFs, 'purchase_orders', order.id), {
                    status: 'RECEIVED',
                    resolved_at: new Date().toISOString(),
                    resolved_by: this.currentUsername
                });

                alert("Success: Consignment received and live balances populated cleanly!");
            } catch (error) {
                alert("Approval execution error: " + error.message);
            }
        },

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

        logout() { sessionStorage.removeItem(SESSION_KEY); this.isAuthenticated = false; this.currentRole = 'readonly'; this.currentUsername = ''; this.currentUserId = null; },
        async deleteNote(noteId) { await deleteDoc(doc(dbFs, 'notes', noteId)); },
        
        async changeItemName(item) {
            let updatedName = prompt(`Update Name for "${item.name}":`, item.name); if (!updatedName?.trim()) return;
            let promptPrice = prompt(`Update MRP for "${updatedName.trim()}":`, item.mrp || 0); if (promptPrice === null) return;
            try {
                await updateDoc(doc(dbFs, 'items', item.id), { name: updatedName.trim(), mrp: Number(promptPrice) || 0 });
                alert("Item details edited.");
            } catch (e) { alert(e.message); }
        },
        async modifyThreshold(item) {
            let promptVal = prompt('Update safety limit:', item.threshold);
            if (promptVal !== null) await updateDoc(doc(dbFs, 'items', item.id), { threshold: parseInt(promptVal) || 0 });
        },
        async purgeItem(id) { if (confirm('Purge item entry?')) await deleteDoc(doc(dbFs, 'items', id)); },
        async shiftOrder(id, direction) {
            const sorted = [...this.items].sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
            const idx = sorted.findIndex((i) => i.id === id); if (idx === -1) return;
            const swapIdx = idx + (direction === 'up' ? -1 : 1); if (swapIdx < 0 || swapIdx >= sorted.length) return;
            await updateDoc(doc(dbFs, 'items', sorted[idx].id), { order_index: sorted[swapIdx].order_index || 0 });
            await updateDoc(doc(dbFs, 'items', sorted[swapIdx].id), { order_index: sorted[idx].order_index || 0 });
        },
        async submitNewItem() {
            if (!this.newItemForm.name.trim() || !this.newItemForm.categoryId) return;
            const maxOrder = this.items.reduce((m, i) => Math.max(m, i.order_index || 0), 0);
            await addDoc(colRef('items'), { name: this.newItemForm.name.trim(), category_id: this.newItemForm.categoryId, stock: 0, threshold: this.newItemForm.threshold || 0, mrp: Number(this.newItemForm.mrp || 0), order_index: maxOrder + 1 });
            this.newItemForm = { name: '', categoryId: '', newCategoryEmoji: '🍱', newCategoryName: '', threshold: 0, mrp: '' };
            this.showNewItemModal = false;
        },
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
                await addDoc(colRef('logs'), { type: 'INWARD', item_id: target.id, qty, supplier_name: vendor, department: null, created_at: new Date().toISOString(), created_by_name: this.currentUsername });
                this.formInward = { itemId: '', qty: '', supplierName: '' };
            } catch (error) { alert("Database write error: " + error.message); }
        },
        async deductOutward() {
            if (!this.formOutward.itemId || !this.formOutward.qty) return alert('Select missing fields.');
            const target = this.items.find((i) => String(i.id) === String(this.formOutward.itemId)); if (!target) return alert('Item not found.');
            const qty = parseInt(this.formOutward.qty); if (!qty || qty <= 0) return alert('Enter positive quantity.');
            if (Number(target.stock || 0) < qty) return alert('Insufficient stock.');
            try {
                await updateDoc(doc(dbFs, 'items', target.id), { stock: Number(target.stock) - qty });
                await addDoc(colRef('logs'), { type: 'OUTWARD', item_id: target.id, qty, department: this.formOutward.department, created_at: new Date().toISOString(), created_by_name: this.currentUsername });
                this.formOutward = { itemId: '', department: 'Indian', qty: '' };
            } catch (error) { alert("Error: " + error.message); }
        },
        async changeUserRole(userId, role) { await updateDoc(doc(dbFs, 'users', userId), { role }); },
        async deleteUser(userId) { if (confirm('Delete user?')) await deleteDoc(doc(dbFs, 'users', userId)); },
        
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
            const { username, password, role = 'inward' } = this.newUserForm;
            if (!username || password.length < 6) return;
            await addDoc(colRef('users'), { username: username.trim(), passwordHash: await sha256(password), role });
            this.newUserForm = { username: '', password: '', role: 'inward' };
        },
        
        async promptResetPassword(user) {
            let newPass = prompt(`Enter new password for ${user.username} (Min 6 chars):`);
            if (!newPass || newPass.trim().length < 6) return alert('Min 6 characters required.');
            try {
                const hashed = await sha256(newPass.trim());
                await updateDoc(doc(dbFs, 'users', user.id), { passwordHash: hashed });
                alert("Password reset completed successfully!");
            } catch (error) { alert("Reset failed: " + error.message); }
        },

        downloadInwardSupplierReport() {
            const inwards = this.logs.filter(l => l.type === 'INWARD'); if (!inwards.length) return alert("No inward data.");
            const supplierGroups = {};
            inwards.forEach(log => {
                const sName = log.supplier_name || 'Historical / Unassigned Vendor';
                if (!supplierGroups[sName]) supplierGroups[sName] = []; supplierGroups[sName].push(log);
            });
            const sheetMatrix = [];
            Object.keys(supplierGroups).forEach(supplier => {
                sheetMatrix.push([`🚚 SUPPLIER LEDGER: ${supplier.toUpperCase()}`]); sheetMatrix.push(["ITEM NAME", "QUANTITY RECEIVED", "UNIT PRICE (MRP)", "TOTAL VALUATION"]);
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

// 🟢 THE BOOTSTRAP FIX: Clean binding to ensure Alpine can find components on race condition loads
document.addEventListener('DOMContentLoaded', () => {
    if (window.Alpine) {
        window.Alpine.data('stockApp', window.stockApp);
    } else {
        document.addEventListener('alpine:init', () => {
            window.Alpine.data('stockApp', window.stockApp);
        });
    }
    console.log("🚀 stockApp successfully bound to global Alpine execution hooks.");
});
