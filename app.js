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
        cateringEvents: [], 
        logs: [],
        allRawLogs: [],
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
        filterSupplier: 'all',
        orderViewTab: 'pending', 
        
        loginForm: { username: '', password: '' },
        loginError: '',
        formInward: { itemId: '', qty: '', supplierName: '' }, 
        formOutward: { itemId: '', department: 'Indian', qty: '' },

        // Catering Matrix Buffers
        cateringForm: { partyName: '', paxCount: '', rawTextMenu: '' },
        cateringModal: { show: false, label: '', text: '' },
        editingEventId: null,
        
        orderDesk: {
            supplierId: '',
            selectedItemId: '',
            selectedQty: '',
            basket: [] 
        }, 
        
        lastLogId: null,
        lastLogType: '',
        
        showNewItemModal: false,
        showAccountModal: false,
        showUserAdminModal: false,
        
        newItemForm: { name: '', categoryId: '', supplierName: '', threshold: 0, mrp: '' }, 
        newCategoryForm: { name: '', emoji: '📦', paletteIndex: 0 },
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

        async init() {
            await seedIfEmpty();
            
            onSnapshot(colRef('categories'), (snap) => { this.categories = snap.docs.map((d) => ({ id: d.id, ...d.data() })); });
            onSnapshot(colRef('items'), (snap) => { this.items = snap.docs.map((d) => ({ id: d.id, ...d.data() })); });
            onSnapshot(colRef('suppliers'), (snap) => { this.suppliers = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a,b) => a.name.localeCompare(b.name)); });

            onSnapshot(colRef('purchase_orders'), (snap) => {
                this.purchaseOrders = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
                    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            });
            
            onSnapshot(colRef('catering_events'), (snap) => { 
                this.cateringEvents = snap.docs.map((d) => ({ id: d.id, ...d.data() })); 
            });

            onSnapshot(colRef('logs'), (snap) => { 
                this.allRawLogs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
                const todayStr = new Date().toISOString().slice(0, 10);
                
                this.logs = [...this.allRawLogs]
                    .filter((l) => l.created_at && l.created_at.slice(0, 10) === todayStr)
                    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                    .slice(0, 50)
                    .map((l) => {
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

        // EXCEL BULK INGEST (ADMIN / INWARD ONLY)
        async uploadExcelReport(event) {
            if (this.currentRole !== 'admin' && this.currentRole !== 'inward') {
                alert("Security Exception: Your operating role scope does not authorize bulk database ingest mutations.");
                event.target.value = "";
                return;
            }

            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const sheetName = workbook.SheetNames[0];
                    const jsonRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

                    if (jsonRows.length === 0) return alert("The uploaded sheet contains no data.");

                    let addedItemsCount = 0;

                    for (let row of jsonRows) {
                        const rawItemName = row["Item Name"]?.toString().trim();
                        const rawBalance = Number(row["Live Balance"]) || 0;
                        const rawLimit = Number(row["Safety Limit"]) || 0;
                        const rawMrp = Number(row["Unit Price (MRP)"]?.toString().replace(/[^0-9.]/g, '')) || 0;
                        const rawCategory = row["Category Axis"]?.toString().trim();
                        const rawSupplier = row["Primary Supplier"]?.toString().trim();

                        if (!rawItemName) continue;

                        let categoryId = 'kirana';
                        if (rawCategory) {
                            const existingCat = this.categories.find(c => c.name.toLowerCase() === rawCategory.toLowerCase());
                            if (!existingCat) {
                                const newCatId = rawCategory.toLowerCase().replace(/\s+/g, '-');
                                await setDoc(doc(dbFs, 'categories', newCatId), {
                                    name: rawCategory,
                                    emoji: "📦",
                                    bg_color: "#f8fafc",
                                    border_color: "#64748b",
                                    text_color: "#334151"
                                });
                                categoryId = newCatId;
                            } else {
                                categoryId = existingCat.id;
                            }
                        }

                        if (rawSupplier && !this.suppliers.some(s => s.name.toLowerCase() === rawSupplier.toLowerCase())) {
                            await addDoc(colRef('suppliers'), { name: rawSupplier, phone: '' });
                        }

                        const itemExists = this.items.some(i => i.name.toLowerCase() === rawItemName.toLowerCase());
                        if (!itemExists) {
                            await addDoc(colRef('items'), {
                                name: rawItemName,
                                stock: rawBalance,
                                threshold: rawLimit,
                                mrp: rawMrp,
                                category_id: categoryId,
                                supplier_name: rawSupplier || (this.suppliers[0] ? this.suppliers[0].name : 'General Vendor'),
                                order_index: this.items.length + 1
                            });
                            addedItemsCount++;
                        }
                    }

                    alert(`Ingestion completed cleanly! Added ${addedItemsCount} brand new items.`);
                    event.target.value = "";
                } catch (err) {
                    alert("Failed to parse spreadsheet: " + err.message);
                }
            };
            reader.readAsArrayBuffer(file);
        },

        async submitNewCategory() {
            if (!this.newCategoryForm.name.trim()) return alert("Category title required.");
            const palette = this.paletteOptions[this.newCategoryForm.paletteIndex];
            
            const rawName = this.newCategoryForm.name.trim();
            const formattedName = rawName.charAt(0).toUpperCase() + rawName.slice(1).toLowerCase();
            const newId = formattedName.toLowerCase().replace(/\s+/g, '-');
            
            try {
                await setDoc(doc(dbFs, 'categories', newId), {
                    name: formattedName,
                    emoji: this.newCategoryForm.emoji,
                    bg_color: palette.bg,
                    border_color: palette.border,
                    text_color: palette.text
                });
                this.newCategoryForm = { name: '', emoji: '📦', paletteIndex: 0 };
                alert("New category axis provisioned cleanly.");
            } catch(e) { alert(e.message); }
        },

        get processedItems() {
            let dataset = this.items.map((i) => {
                const cat = this.categories.find((c) => c.id === i.category_id) || {};
                return { ...i, category_name: cat.name || 'Unassigned', emoji: cat.emoji || '📦', bg: cat.bg_color || '#f3f4f6', border: cat.border_color || '#9ca3af', text_color: cat.text_color || '#374151' };
            });

            if (this.filterCat !== 'all') {
                dataset = dataset.filter((i) => i.category_name === this.filterCat);
            }

            if (this.filterSupplier !== 'all') {
                const defaultSupplier = this.suppliers[0] ? this.suppliers[0].name : '';
                dataset = dataset.filter((i) => (i.supplier_name || defaultSupplier) === this.filterSupplier);
            }

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

        get processedPurchaseOrders() {
            const currentStatusTab = String(this.orderViewTab).toLowerCase();
            return this.purchaseOrders.filter(o => {
                const orderStatus = String(o.status).toLowerCase();
                if (currentStatusTab === 'pending') {
                    return orderStatus === 'pending';
                } else {
                    return orderStatus !== 'pending';
                }
            });
        },

        // CATERING MATRIX ENGINE
        getEventsForDate(dateStr) {
            if (!dateStr || !this.cateringEvents) return [];
            return this.cateringEvents.filter(ev => String(ev.date) === String(dateStr));
        },

        getEventCountForDate(dateStr) {
            return this.getEventsForDate(dateStr).length;
        },

        viewCateringTextMenu(eventObj) {
            this.cateringModal.label = `${eventObj.partyName} (${eventObj.paxCount} Pax)`;
            this.cateringModal.text = eventObj.menuText;
            this.cateringModal.show = true;
        },

        clearCateringForm() {
            this.cateringForm.partyName = '';
            this.cateringForm.paxCount = '';
            this.cateringForm.rawTextMenu = '';
            this.editingEventId = null;
        },

        editCateringEvent(eventObj) {
            this.cateringForm.partyName = eventObj.partyName;
            this.cateringForm.paxCount = eventObj.paxCount;
            this.cateringForm.rawTextMenu = eventObj.menuText;
            this.editingEventId = eventObj.id;
        },

        async deleteCateringEvent(eventId) {
            if (!confirm("Are you sure you want to completely delete this catering event?")) return;
            try {
                await deleteDoc(doc(dbFs, "catering_events", eventId));
                this.cateringEvents = this.cateringEvents.filter(e => e.id !== eventId);
                alert("Function successfully deleted from cloud records.");
            } catch (err) {
                alert("Operation failed: " + err.message);
            }
        },

        async submitDirectTextCatering(dateString) {
            if (!this.cateringForm.partyName || !this.cateringForm.rawTextMenu) {
                alert("Please fill out the party title and paste text menu data.");
                return;
            }

            const payload = {
                date: dateString,
                partyName: this.cateringForm.partyName.trim(),
                paxCount: Number(this.cateringForm.paxCount) || 0,
                menuText: this.cateringForm.rawTextMenu,
                updated_at: Date.now()
            };

            try {
                if (this.editingEventId) {
                    await setDoc(doc(dbFs, "catering_events", this.editingEventId), payload, { merge: true });
                    const idx = this.cateringEvents.findIndex(e => e.id === this.editingEventId);
                    if (idx !== -1) {
                        this.cateringEvents[idx] = { id: this.editingEventId, ...payload };
                    }
                    this.editingEventId = null;
                    alert("Function record context updated successfully!");
                } else {
                    payload.created_at = Date.now();
                    const docRef = await addDoc(colRef('catering_events'), payload);
                    payload.id = docRef.id;
                    this.cateringEvents = [...this.cateringEvents, payload];
                    alert("Fresh function logged successfully!");
                }

                this.clearCateringForm();
            } catch (err) {
                alert("Mutation failure: " + err.message);
            }
        },

        addItemToOrder() {
            if (!this.orderDesk.selectedItemId || !this.orderDesk.selectedQty || this.orderDesk.selectedQty <= 0) {
                alert("Please select a product and enter a valid quantity.");
                return;
            }

            const itemObj = this.items.find(i => i.id === this.orderDesk.selectedItemId);
            if (!itemObj) return;

            this.orderDesk.basket.push({
                id: itemObj.id,
                name: itemObj.name,
                qty: Number(this.orderDesk.selectedQty)
            });

            this.orderDesk.selectedItemId = '';
            this.orderDesk.selectedQty = '';
        },

        removeOrderBasketItem(index) {
            this.orderDesk.basket.splice(index, 1);
        },

        sendWhatsAppOrder() {
            if (!this.orderDesk.supplierId || this.orderDesk.basket.length === 0) {
                alert("Please select a supplier and add items to your purchase basket.");
                return;
            }

            const supplierObj = this.suppliers.find(s => s.id === this.orderDesk.supplierId);
            const supplierName = supplierObj ? supplierObj.name : "Supplier";

            let messageLines = [
                `*PURCHASE ORDER MANIFEST*`,
                `*To:* ${supplierName}`,
                `*Date:* ${new Date().toLocaleDateString('en-GB')}`,
                `--------------------------------`,
                `*Requested Items:*`
            ];

            this.orderDesk.basket.forEach((item, index) => {
                let name = item.name;
                let qty = item.qty;

                const gramMatch = name.match(/(\d+)\s*(gms?|gram|grams?|g)\b/i);
                const mlMatch = name.match(/(\d+)\s*(ml|milliliters?)\b/i);

                let formattedString = `${index + 1}. ${name} - Qty: ${qty}`;

                if (gramMatch) {
                    const unitWeightGrams = parseInt(gramMatch[1], 10);
                    const totalGrams = unitWeightGrams * qty;
                    const baseName = name.replace(gramMatch[0], '').trim();

                    if (totalGrams >= 1000) {
                        const totalKg = totalGrams / 1000;
                        formattedString = `${index + 1}. *${baseName} ${totalKg} kg*`;
                    } else {
                        formattedString = `${index + 1}. *${baseName} ${totalGrams} gms*`;
                    }
                } else if (mlMatch) {
                    const unitVolumeMl = parseInt(mlMatch[1], 10);
                    const totalMl = unitVolumeMl * qty;
                    const baseName = name.replace(mlMatch[0], '').trim();

                    if (totalMl >= 1000) {
                        const totalL = totalMl / 1000;
                        formattedString = `${index + 1}. *${baseName} ${totalL} Liters*`;
                    } else {
                        formattedString = `${index + 1}. *${baseName} ${totalMl} ml*`;
                    }
                }

                messageLines.push(formattedString);
            });

            messageLines.push(`--------------------------------`);
            messageLines.push(`Please confirm receipt and dispatch schedule.`);

            const fullMessage = encodeURIComponent(messageLines.join('\n'));
            window.open(`https://wa.me/?text=${fullMessage}`, '_blank');
        },

        async approveIncomingOrder(order) {
            if (order.status !== 'PENDING') return;
            if (!confirm(`Confirm stock ingestion from ${order.supplier_name}? Live balances will update based on the quantities listed below.`)) return;

            try {
                let hasMissingItems = false;
                let hasReceivedItems = false;

                for (let record of order.items) {
                    const arrivedQty = parseInt(record.qty) || 0;
                    
                    if (arrivedQty < 0) {
                        alert(`Operation Denied: Negative value (${arrivedQty}) detected for item "${record.name}".`);
                        return; 
                    }
                    
                    if (arrivedQty === 0) {
                        hasMissingItems = true;
                    }

                    const targetItem = this.items.find(i => String(i.id) === String(record.id));
                    if (targetItem && arrivedQty > 0) {
                        hasReceivedItems = true;
                        await updateDoc(doc(dbFs, 'items', targetItem.id), { stock: Number(targetItem.stock || 0) + arrivedQty });
                        await addDoc(colRef('logs'), { type: 'INWARD', item_id: targetItem.id, qty: arrivedQty, supplier_name: order.supplier_name, department: null, created_at: new Date().toISOString(), created_by_name: this.currentUsername });
                    }
                }

                let finalStatus = 'RECEIVED';
                if (hasMissingItems && hasReceivedItems) finalStatus = 'PARTIAL';
                else if (!hasReceivedItems) finalStatus = 'DECLINED';

                await updateDoc(doc(dbFs, 'purchase_orders', order.id), { status: finalStatus, items: order.items, resolved_at: new Date().toISOString(), resolved_by: this.currentUsername });
                alert(`Order marked as [${finalStatus}]. Balances synchronized cleanly.`);
            } catch (error) { alert("Approval processing error: " + error.message); }
        },

        async declineIncomingOrder(order) {
            if (order.status !== 'PENDING') return;
            if (!confirm(`Are you sure you want to DECLINE and cancel this order from ${order.supplier_name}?`)) return;
            try {
                await updateDoc(doc(dbFs, 'purchase_orders', order.id), { status: 'DECLINED', resolved_at: new Date().toISOString(), resolved_by: this.currentUsername });
                alert("Order successfully canceled and marked as DECLINED.");
            } catch (error) { alert("Error canceling order: " + error.message); }
        },

        isWithin30Minutes(createdAt) {
            if (!createdAt) return false;
            return (new Date() - new Date(createdAt)) < 1800000; 
        },

        async triggerUndo(log) {
            if (!this.isWithin30Minutes(log.created_at)) {
                return alert("Reversal Rejected: Exceeded 30-minute undo window.");
            }
            if (!confirm("Are you sure you want to revert this specific entry?")) return;
            try {
                const targetItem = this.items.find(i => String(i.id) === String(log.item_id));
                if (!targetItem) return alert("Target item no longer exists.");
                let currentBal = Number(targetItem.stock || 0);
                let corrected = log.type === 'INWARD' ? currentBal - parseInt(log.qty) : currentBal + parseInt(log.qty);
                if (corrected < 0) return alert("Reversal denied: Stock cannot go below zero.");
                await updateDoc(doc(dbFs, 'items', targetItem.id), { stock: corrected });
                await deleteDoc(doc(dbFs, 'logs', log.id));
                alert("Transaction rolled back successfully!");
            } catch(e) { alert("Error: " + e.message); }
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
                const docRef = await addDoc(colRef('logs'), { type: 'INWARD', item_id: target.id, qty, supplier_name: vendor, department: null, created_at: new Date().toISOString(), created_by_name: this.currentUsername });
                this.lastLogId = docRef.id; this.lastLogType = 'INWARD';
                this.formInward = { itemId: '', qty: '', supplierName: '' };
            } catch (error) { alert("Database write error: " + error.message); }
        },

        async deductOutward() {
            if (!this.formOutward.itemId || !this.formOutward.qty) return alert('Select missing fields.');
            const target = this.items.find((i) => String(i.id) === String(this.formOutward.itemId)); if (!target) return alert('Item not found.');
            const qty = parseInt(this.formOutward.qty); if (!qty || qty <= 0) return alert('Enter positive quantity.');
            if (Number(target.stock || 0) < qty) return alert('Insufficient stock.');
            try {
                const docRef = await addDoc(colRef('logs'), { type: 'OUTWARD', item_id: target.id, qty, department: this.formOutward.department, created_at: new Date().toISOString(), created_by_name: this.currentUsername });
                await updateDoc(doc(dbFs, 'items', target.id), { stock: Number(target.stock) - qty });
                this.lastLogId = docRef.id; this.lastLogType = 'OUTWARD';
                this.formOutward = { itemId: '', department: 'Indian', qty: '' };
            } catch (error) { alert("Error: " + error.message); }
        },

        async undoLastTransaction() {
            if (!this.lastLogId) return alert("No recent log found.");
            if (!confirm(`Are you sure you want to REVERT your last ${this.lastLogType} entry?`)) return;
            try {
                const logsSnap = await getDocs(colRef('logs'));
                const targetingLog = logsSnap.docs.find(d => d.id === this.lastLogId);
                if (!targetingLog) { this.lastLogId = null; return; }
                const logData = targetingLog.data();
                if (!this.isWithin30Minutes(logData.created_at)) return alert("Reversal window expired.");
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

        logout() { 
            sessionStorage.removeItem(SESSION_KEY); 
            this.isAuthenticated = false; 
            this.currentRole = 'readonly'; 
            this.currentUsername = ''; 
            this.currentUserId = null; 
            window.location.reload();
        },

        async changeUserRole(userId, role) { await updateDoc(doc(dbFs, 'users', userId), { role }); },
        async deleteUser(userId) { if (confirm('Delete user?')) await deleteDoc(doc(dbFs, 'users', userId)); },
        
        async changeMyPassword() {
            if (this.currentRole !== 'admin') return alert("Access Rejected: Only platform Administrators can modify profiles.");
            this.accountError = ''; this.accountSuccess = '';
            const { currentPassword, newPassword } = this.accountForm;
            if (newPassword.length < 6) { this.accountError = 'Min 6 characters'; return; }
            const user = this.users.find((u) => u.id === this.currentUserId);
            if ((await sha256(currentPassword)) !== user.passwordHash) { this.accountError = 'Incorrect password'; return; }
            await updateDoc(doc(dbFs, 'users', user.id), { passwordHash: await sha256(newPassword) });
            this.accountSuccess = 'Password updated.';
            this.accountForm = { currentPassword: '', newPassword: '' };
        },

        async createUser() {
            const { username, password, role = 'inward' } = this.newUserForm;
            if (!username || password.length < 6) return alert("Username required and password must be 6+ chars.");
            try {
                const passwordHash = await sha256(password);
                await addDoc(colRef('users'), { username: username.trim(), passwordHash, role });
                this.newUserForm = { username: '', password: '', role: 'inward' };
                alert("Operator successfully configured.");
            } catch (e) {
                alert("Error configuring operator: " + e.message);
            }
        },
        
        async promptResetPassword(user) {
            if (this.currentRole !== 'admin') return alert("Operation Denied.");
            let newPass = prompt(`Enter new password for ${user.username} (Min 6 chars):`);
            if (!newPass || newPass.trim().length < 6) return alert("Minimum 6 characters needed.");
            try {
                await updateDoc(doc(dbFs, 'users', user.id), { passwordHash: await sha256(newPass.trim()) });
                alert("Password updated!");
            } catch (error) { alert(error.message); }
        },

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
        async shiftOrder(id, direction) {
            const sorted = [...this.items].sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
            const idx = sorted.findIndex((i) => i.id === id); if (idx === -1) return;
            const swapIdx = idx + (direction === 'up' ? -1 : 1); if (swapIdx < 0 || swapIdx >= sorted.length) return;
            await updateDoc(doc(dbFs, 'items', sorted[idx].id), { order_index: sorted[swapIdx].order_index || 0 });
            await updateDoc(doc(dbFs, 'items', sorted[swapIdx].id), { order_index: sorted[idx].order_index || 0 });
        },

        async submitNewItem() {
            if (!this.newItemForm.name.trim() || !this.newItemForm.categoryId || !this.newItemForm.supplierName) return alert("Please map all tags.");
            const maxOrder = this.items.reduce((m, i) => Math.max(m, i.order_index || 0), 0);
            await addDoc(colRef('items'), { name: this.newItemForm.name.trim(), category_id: this.newItemForm.categoryId, supplier_name: this.newItemForm.supplierName, stock: 0, threshold: this.newItemForm.threshold || 0, mrp: Number(this.newItemForm.mrp || 0), order_index: maxOrder + 1 });
            this.newItemForm = { name: '', categoryId: '', supplierName: '', threshold: 0, mrp: '' };
            this.showNewItemModal = false;
        },

        downloadInwardSupplierReport() {
            const inwards = this.allRawLogs.filter(l => l.type === 'INWARD' && l.created_at);
            if (!inwards.length) return alert("No inward data available to generate a monthly report.");

            const wb = XLSX.utils.book_new();
            const dateGroups = {};
            inwards.forEach(log => {
                const dateKey = log.created_at.slice(0, 10); 
                if (!dateGroups[dateKey]) dateGroups[dateKey] = [];
                dateGroups[dateKey].push(log);
            });

            const sortedDates = Object.keys(dateGroups).sort((a, b) => new Date(a) - new Date(b));

            sortedDates.forEach(dateStr => {
                const logsForDay = dateGroups[dateStr];
                const dateObj = new Date(dateStr);
                const dayNum = dateObj.getDate();
                const monthShort = dateObj.toLocaleDateString('en-GB', { month: 'short' });
                const sheetTabName = `${dayNum}${monthShort}`; 

                const supplierGroups = {};
                logsForDay.forEach(log => {
                    const sName = log.supplier_name || 'Historical Vendor';
                    if (!supplierGroups[sName]) supplierGroups[sName] = [];
                    supplierGroups[sName].push(log);
                });

                const sheetMatrix = [];

                Object.keys(supplierGroups).forEach(supplier => {
                    sheetMatrix.push([`Supplier: ${supplier.toUpperCase()}`]);
                    sheetMatrix.push(["ITEM NAME", "QUANTITY RECEIVED", "UNIT PRICE", "TOTAL VALUATION"]);
                    
                    let grandTotal = 0;
                    supplierGroups[supplier].forEach(log => {
                        const linkedItem = this.items.find(i => String(i.id) === String(log.item_id)) || {};
                        const name = log.item_name || linkedItem.name;
                        const qty = parseInt(log.qty) || 0;
                        const price = parseFloat(linkedItem.mrp) || 0;
                        const totalCost = qty * price;
                        grandTotal += totalCost;
                        
                        sheetMatrix.push([name, qty, `₹${price}`, `₹${totalCost}`]);
                    });
                    
                    sheetMatrix.push(["", "", "GRAND TOTAL:", `₹${grandTotal}`]);
                    sheetMatrix.push([]); 
                });

                const ws = XLSX.utils.aoa_to_sheet(sheetMatrix);
                ws['!cols'] = [{ wch: 26 }, { wch: 20 }, { wch: 14 }, { wch: 18 }];
                XLSX.utils.book_append_sheet(wb, ws, sheetTabName);
            });

            const currentMonthYear = new Date().toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }).replace(' ', '_');
            XLSX.writeFile(wb, `Monthly_Inward_Breakdown_Report_${currentMonthYear}.xlsx`);
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
                    let dayInwards = this.allRawLogs.filter(l => l.created_at && String(l.item_id) === String(item.id) && l.type === 'INWARD' && l.created_at.slice(0, 10) === targetDate);
                    row.push(dayInwards.length ? `+${dayInwards.reduce((sum, l) => sum + (parseInt(l.qty) || 0), 0)}` : "0");
                    let dayOutwards = this.allRawLogs.filter(l => l.created_at && String(l.item_id) === String(item.id) && l.type === 'OUTWARD' && l.created_at.slice(0, 10) === targetDate);
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

document.addEventListener('alpine:init', () => {
    window.Alpine.data('stockApp', window.stockApp);
});
