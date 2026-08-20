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

let swRegistration = null;
if (typeof window !== 'undefined' && 'serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
        swRegistration = reg;
    }).catch((err) => console.warn('Service Worker registration skipped:', err));
}

async function sendBrowserNotification(title, body) {
    if (typeof window === 'undefined' || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    try {
        if (swRegistration && swRegistration.active) {
            swRegistration.showNotification(title, {
                body: body,
                icon: "https://cdn-icons-png.flaticon.com/512/3081/3081840.png",
                badge: "https://cdn-icons-png.flaticon.com/512/3081/3081840.png",
                vibrate: [200, 100, 200]
            });
        } else {
            new Notification(title, { body: body, icon: "https://cdn-icons-png.flaticon.com/512/3081/3081840.png" });
        }
    } catch (err) {
        console.warn("Notification dispatch error:", err);
    }
}

function getItemPackDetails(itemName = "") {
    if (!itemName) return { packSize: 1, unit: "", hasPack: false };
    
    const match = itemName.match(/(\d+(?:\.\d+)?)\s*(kg|kgs|kilo|kilograms?|gm|gms|g|grams?|l|ltr|liters?|litres?|ml|pkts?|packets?|pcs?|pieces?|box|boxes|tins?|bottles?|cans?)\b/i);
    if (match) {
        return {
            packSize: parseFloat(match[1]),
            unit: match[2],
            hasPack: true
        };
    }

    const unitOnlyMatch = itemName.match(/\b(kg|kgs|kilo|kilograms?|gm|gms|g|grams?|l|ltr|liters?|litres?|ml|pkts?|packets?|pcs?|pieces?|box|boxes|tins?|bottles?|cans?)\b/i);
    if (unitOnlyMatch) {
        return {
            packSize: 1,
            unit: unitOnlyMatch[1],
            hasPack: false
        };
    }

    return { packSize: 1, unit: "", hasPack: false };
}

function parseQuantityInput(inputStr, itemName = "") {
    if (typeof inputStr === 'number') inputStr = String(inputStr);
    if (!inputStr || !String(inputStr).trim()) return NaN;

    const str = String(inputStr).trim().toLowerCase();
    const pack = getItemPackDetails(itemName);
    const itemUnit = (pack.unit || "").toLowerCase();
    const isKgItem = /\b(kg|kgs|kilo|kilograms?)\b/i.test(itemUnit) || /\b(kg|kgs|kilo|kilograms?)\b/i.test(itemName);
    const isGramItem = /\b(g|gm|gms|gram|grams)\b/i.test(itemUnit) && !isKgItem;
    const isLiterItem = /\b(l|ltr|liter|liters|litre)\b/i.test(itemUnit) || /\b(l|ltr|liter|liters|litre)\b/i.test(itemName);

    const compoundKgG = str.match(/^([\d.]+)\s*(?:kg|kgs|kilo|kilograms?)\s*([\d.]+)\s*(?:g|gm|gms|gram|grams)$/);
    if (compoundKgG) {
        const k = parseFloat(compoundKgG[1]) || 0;
        const g = parseFloat(compoundKgG[2]) || 0;
        return Math.round((k + g / 1000) * 1000) / 1000;
    }

    const gramMatch = str.match(/^([\d.]+)\s*(g|gm|gms|gram|grams)$/);
    if (gramMatch) {
        const grams = parseFloat(gramMatch[1]);
        if (isKgItem) return Math.round((grams / 1000) * 1000) / 1000;
        return grams;
    }

    const kgMatch = str.match(/^([\d.]+)\s*(kg|kgs|kilo|kilograms)$/);
    if (kgMatch) {
        const kgs = parseFloat(kgMatch[1]);
        if (isGramItem) return Math.round(kgs * 1000);
        return kgs;
    }

    const mlMatch = str.match(/^([\d.]+)\s*(ml|milliliters?)$/);
    if (mlMatch) {
        const ml = parseFloat(mlMatch[1]);
        if (isLiterItem) return Math.round((ml / 1000) * 1000) / 1000;
        return ml;
    }

    const literMatch = str.match(/^([\d.]+)\s*(l|ltr|liter|liters|litre)$/);
    if (literMatch) {
        return parseFloat(literMatch[1]);
    }

    if (str.includes('.')) {
        const decimalNum = parseFloat(str.replace(/[^0-9.]/g, ''));
        return isNaN(decimalNum) ? NaN : Math.round(decimalNum * 1000) / 1000;
    }

    const rawNum = parseFloat(str.replace(/[^0-9.]/g, ''));
    if (isNaN(rawNum)) return NaN;

    if (pack.hasPack && pack.packSize > 0) {
        return Math.round(rawNum * pack.packSize * 1000) / 1000;
    }

    return rawNum;
}

function formatStockDisplay(stock, itemName = "") {
    const val = Number(stock) || 0;
    const pack = getItemPackDetails(itemName);
    const unit = (pack.unit || "").toLowerCase();
    const isKg = /\b(kg|kgs|kilo|kilograms?)\b/i.test(unit) || /\b(kg|kgs|kilo|kilograms?)\b/i.test(itemName);
    const isLiter = /\b(l|ltr|liter|liters|litre)\b/i.test(unit) || /\b(l|ltr|liter|liters|litre)\b/i.test(itemName);
    const isGram = /\b(g|gm|gms|gram|grams)\b/i.test(unit) && !isKg;

    if (isKg) {
        const isNegative = val < 0;
        const absVal = Math.abs(val);
        let wholeKg = Math.floor(absVal);
        let remGrams = Math.round((absVal - wholeKg) * 1000);
        if (remGrams === 1000) {
            wholeKg += 1;
            remGrams = 0;
        }

        let formatted = "";
        if (wholeKg > 0 && remGrams > 0) {
            formatted = `${wholeKg} kg ${remGrams} g`;
        } else if (wholeKg > 0 && remGrams === 0) {
            formatted = `${wholeKg} kg`;
        } else if (wholeKg === 0 && remGrams > 0) {
            formatted = `${remGrams} g`;
        } else {
            formatted = `0 kg`;
        }
        return (isNegative ? "-" : "") + formatted;
    }

    if (isGram) {
        if (val >= 1000) {
            let wholeKg = Math.floor(val / 1000);
            let remG = Math.round(val % 1000);
            return remG > 0 ? `${wholeKg} kg ${remG} g` : `${wholeKg} kg`;
        }
        return `${val} g`;
    }

    if (isLiter) {
        const isNegative = val < 0;
        const absVal = Math.abs(val);
        let wholeL = Math.floor(absVal);
        let remMl = Math.round((absVal - wholeL) * 1000);
        if (remMl === 1000) {
            wholeL += 1;
            remMl = 0;
        }

        let formatted = "";
        if (wholeL > 0 && remMl > 0) {
            formatted = `${wholeL} L ${remMl} ml`;
        } else if (wholeL > 0 && remMl === 0) {
            formatted = `${wholeL} L`;
        } else if (wholeL === 0 && remMl > 0) {
            formatted = `${remMl} ml`;
        } else {
            formatted = `0 L`;
        }
        return (isNegative ? "-" : "") + formatted;
    }

    if (pack.unit) {
        return `${val} ${pack.unit}`;
    }

    return `${val}`;
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

export function stockAppDefinition() {
    return {
        categories: [],
        items: [],
        cateringEvents: [], 
        logs: [],
        allRawLogs: [],
        users: [],
        suppliers: [], 
        purchaseOrders: [], 
        
        ready: true,
        isAuthenticated: false,
        authChecking: false,
        currentRole: 'readonly',
        currentUsername: '',
        currentUserId: null,
        filterCat: 'all',
        filterSupplier: 'all',
        orderViewTab: 'pending', 
        
        loginForm: { username: '', password: '' },
        loginError: '',
        formInward: { itemId: '', qty: '', supplierName: '', customDate: '' }, 
        formOutward: { itemId: '', department: 'Indian', qty: '', customDate: '' },

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

        formatStock(stock, itemName = "") {
            return formatStockDisplay(stock, itemName);
        },

        async init() {
            this.restoreSession();

            try {
                await seedIfEmpty();
            } catch (err) {
                console.warn("Seeding error:", err);
            }
            
            onSnapshot(colRef('categories'), (snap) => { this.categories = snap.docs.map((d) => ({ id: d.id, ...d.data() })); });
            onSnapshot(colRef('items'), (snap) => { this.items = snap.docs.map((d) => ({ id: d.id, ...d.data() })); });
            onSnapshot(colRef('suppliers'), (snap) => { this.suppliers = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a,b) => a.name.localeCompare(b.name)); });

            onSnapshot(colRef('purchase_orders'), (snap) => {
                this.purchaseOrders = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
                    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            });
            
            let isInitialEventLoad = true;
            onSnapshot(colRef('catering_events'), (snap) => { 
                const events = snap.docs.map((d) => ({ id: d.id, ...d.data() })); 
                if (!isInitialEventLoad) {
                    snap.docChanges().forEach((change) => {
                        if (change.type === "added") {
                            const data = change.doc.data();
                            sendBrowserNotification(
                                "🎉 High-Pax Catering Event Scheduled!",
                                `Party: ${data.partyName} | Attendance: ${data.paxCount} Pax | Date: ${data.date}`
                            );
                        }
                    });
                }
                this.cateringEvents = events;
                isInitialEventLoad = false;
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
                this.restoreSession();
            });

            this.initDailyStockCheckSchedule();
        },

        initDailyStockCheckSchedule() {
            let lastTrigger = "";
            setInterval(() => {
                const now = new Date();
                const hours = now.getHours();
                const minutes = now.getMinutes();
                const todayStr = now.toISOString().slice(0, 10);

                if (hours === 11 && minutes === 0 && lastTrigger !== `${todayStr}_1100`) {
                    lastTrigger = `${todayStr}_1100`;
                    this.notifyLowStockItems("11:00 AM Low Stock Audit Alert");
                }

                if (hours === 22 && minutes === 30 && lastTrigger !== `${todayStr}_2230`) {
                    lastTrigger = `${todayStr}_2230`;
                    this.notifyLowStockItems("10:30 PM Nightly Stock Alert");
                }
            }, 30000);
        },

        async requestNotificationAccess() {
            if (!("Notification" in window)) {
                alert("This browser/device does not support Web Notifications.");
                return;
            }
            const permission = await Notification.requestPermission();
            if (permission === "granted") {
                await sendBrowserNotification("Notifications Activated! 🔔", "You will receive real-time catering allocations and low stock alerts.");
            } else {
                alert("Permission was denied. Please allow notifications in site settings.");
            }
        },

        notifyLowStockItems(triggerTitle = "Low Stock Alert") {
            const lowItems = this.items.filter(i => (Number(i.stock) || 0) <= (Number(i.threshold) || 0));
            if (lowItems.length > 0) {
                const itemSummary = lowItems.slice(0, 4).map(i => `${i.name}: ${this.formatStock(i.stock, i.name)}`).join(', ');
                const extra = lowItems.length > 4 ? ` and ${lowItems.length - 4} more` : '';
                sendBrowserNotification(`⚠️ ${triggerTitle}`, `${lowItems.length} items reached safety limit: ${itemSummary}${extra}`);
            }
        },

        restoreSession() {
            try {
                const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
                if (session && session.userId) {
                    this.currentUserId = session.userId;
                    this.isAuthenticated = true;
                    if (this.users && this.users.length) {
                        const user = this.users.find((u) => u.id === session.userId);
                        if (user) {
                            this.currentUsername = user.username;
                            this.currentRole = user.role;
                        }
                    }
                }
            } catch (e) {
                console.warn(e);
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

        logout() { 
            sessionStorage.removeItem(SESSION_KEY); 
            this.isAuthenticated = false; 
            this.currentRole = 'readonly'; 
            this.currentUsername = ''; 
            this.currentUserId = null; 
            window.location.reload();
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
            if (!confirm("Are you sure you want to delete this event?")) return;
            try {
                await deleteDoc(doc(dbFs, "catering_events", eventId));
                this.cateringEvents = this.cateringEvents.filter(e => e.id !== eventId);
                alert("Event deleted successfully.");
            } catch (err) {
                alert("Operation failed: " + err.message);
            }
        },

        async submitDirectTextCatering(dateString) {
            if (!this.cateringForm.partyName || !this.cateringForm.rawTextMenu) {
                alert("Please fill out the party title and paste menu text.");
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
                    if (idx !== -1) this.cateringEvents[idx] = { id: this.editingEventId, ...payload };
                    this.editingEventId = null;
                    alert("Function updated successfully!");
                } else {
                    payload.created_at = Date.now();
                    const docRef = await addDoc(colRef('catering_events'), payload);
                    payload.id = docRef.id;
                    this.cateringEvents = [...this.cateringEvents, payload];
                    alert("Fresh function logged successfully!");
                }
                this.clearCateringForm();
            } catch (err) {
                alert("Save failure: " + err.message);
            }
        },

        addItemToOrder() {
            if (!this.orderDesk.selectedItemId || !this.orderDesk.selectedQty || this.orderDesk.selectedQty <= 0) {
                alert("Select product and enter valid quantity.");
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
                alert("Select supplier and add items to purchase basket.");
                return;
            }
            const supplierObj = this.suppliers.find(s => s.id === this.orderDesk.supplierId);
            const supplierName = supplierObj ? supplierObj.name : "Supplier";
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);

            let messageLines = [
                `*PURCHASE ORDER: ${supplierName.toUpperCase()}*`,
                `*Date:* ${tomorrow.toLocaleDateString('en-GB')}`,
                `--------------------------------`
            ];

            this.orderDesk.basket.forEach((item, index) => {
                messageLines.push(`${index + 1}. *${item.name} - Qty: ${item.qty}*`);
            });

            window.open(`https://wa.me/?text=${encodeURIComponent(messageLines.join('\n'))}`, '_blank');
        },

        async approveIncomingOrder(order) {
            if (order.status !== 'PENDING') return;
            if (!confirm(`Confirm stock ingestion from ${order.supplier_name}?`)) return;

            try {
                for (let record of order.items) {
                    const arrivedQty = parseFloat(record.qty) || 0;
                    const targetItem = this.items.find(i => String(i.id) === String(record.id));
                    if (targetItem && arrivedQty > 0) {
                        const newStock = Math.round((Number(targetItem.stock || 0) + arrivedQty) * 1000) / 1000;
                        await updateDoc(doc(dbFs, 'items', targetItem.id), { stock: newStock });
                        await addDoc(colRef('logs'), { type: 'INWARD', item_id: targetItem.id, qty: arrivedQty, supplier_name: order.supplier_name, department: null, created_at: new Date().toISOString(), created_by_name: this.currentUsername });
                    }
                }
                await updateDoc(doc(dbFs, 'purchase_orders', order.id), { status: 'RECEIVED', items: order.items, resolved_at: new Date().toISOString(), resolved_by: this.currentUsername });
                alert("Order approved and balances synchronized.");
            } catch (error) { alert("Error: " + error.message); }
        },

        async declineIncomingOrder(order) {
            if (order.status !== 'PENDING') return;
            if (!confirm(`Cancel order from ${order.supplier_name}?`)) return;
            try {
                await updateDoc(doc(dbFs, 'purchase_orders', order.id), { status: 'DECLINED', resolved_at: new Date().toISOString(), resolved_by: this.currentUsername });
                alert("Order canceled.");
            } catch (error) { alert("Error: " + error.message); }
        },

        isWithin30Minutes(createdAt) {
            if (!createdAt) return false;
            return (new Date() - new Date(createdAt)) < 1800000;
        },

        async triggerUndo(log) {
            if (!this.isWithin30Minutes(log.created_at)) return alert("Reversal window (30 min) expired.");
            if (!confirm("Revert this entry?")) return;
            try {
                const targetItem = this.items.find(i => String(i.id) === String(log.item_id));
                if (!targetItem) return alert("Item no longer exists.");
                let currentBal = Number(targetItem.stock || 0);
                let logQty = parseFloat(log.qty) || 0;
                let corrected = log.type === 'INWARD' ? currentBal - logQty : currentBal + logQty;
                corrected = Math.round(corrected * 1000) / 1000;
                if (corrected < 0) return alert("Stock cannot drop below zero.");
                await updateDoc(doc(dbFs, 'items', targetItem.id), { stock: corrected });
                await deleteDoc(doc(dbFs, 'logs', log.id));
                alert("Transaction rolled back successfully!");
            } catch(e) { alert("Error: " + e.message); }
        },

        async addInward() {
            if (!this.formInward.itemId || !this.formInward.qty || !this.formInward.supplierName) return alert('Select missing fields.');
            const target = this.items.find((i) => String(i.id) === String(this.formInward.itemId));
            if (!target) return alert('Selected item not found.');
            
            const qty = parseQuantityInput(this.formInward.qty, target.name); 
            if (isNaN(qty) || qty <= 0) return alert('Enter a valid quantity (e.g. 1, 1.25kg, 1250g, 5kg 250g).');
            
            let vendor = this.formInward.supplierName.trim();
            if (vendor === "_NEW_") {
                let newVendorName = prompt("Enter new Supplier Name:");
                if (!newVendorName || !newVendorName.trim()) return alert("Supplier name required.");
                vendor = newVendorName.trim();
                const matchEx = this.suppliers.find(s => s.name.toLowerCase() === vendor.toLowerCase());
                if (!matchEx) await addDoc(colRef('suppliers'), { name: vendor, phone: '' });
            }

            let entryTimestamp = new Date().toISOString();
            if (this.currentRole === 'admin' && this.formInward.customDate) {
                entryTimestamp = new Date(this.formInward.customDate).toISOString();
            }

            try {
                const newStock = Math.round((Number(target.stock || 0) + qty) * 1000) / 1000;
                await updateDoc(doc(dbFs, 'items', target.id), { stock: newStock });
                const docRef = await addDoc(colRef('logs'), {
                    type: 'INWARD',
                    item_id: target.id,
                    qty, 
                    supplier_name: vendor,
                    department: null,
                    created_at: entryTimestamp,
                    created_by_name: this.currentUsername
                });
                
                this.lastLogId = docRef.id;
                this.lastLogType = 'INWARD';
                this.formInward = { itemId: '', qty: '', supplierName: '', customDate: '' };
                alert(`Inward recorded: +${this.formatStock(qty, target.name)} for "${target.name}".`);
            } catch (error) { 
                alert("Write error: " + error.message);
            }
        },

        async deductOutward() {
            if (!this.formOutward.itemId || !this.formOutward.qty) return alert('Select missing fields.');
            const target = this.items.find((i) => String(i.id) === String(this.formOutward.itemId));
            if (!target) return alert('Item not found.');
            
            const qty = parseQuantityInput(this.formOutward.qty, target.name); 
            if (isNaN(qty) || qty <= 0) return alert('Enter a valid quantity (e.g. 1, 0.5kg, 500g, 5).');
            if (Number(target.stock || 0) < qty) return alert(`Insufficient stock. Current balance is ${this.formatStock(target.stock, target.name)}.`);

            let entryTimestamp = new Date().toISOString();
            if (this.currentRole === 'admin' && this.formOutward.customDate) {
                entryTimestamp = new Date(this.formOutward.customDate).toISOString();
            }

            try {
                const newStock = Math.round((Number(target.stock) - qty) * 1000) / 1000;
                const docRef = await addDoc(colRef('logs'), {
                    type: 'OUTWARD',
                    item_id: target.id,
                    qty, 
                    department: this.formOutward.department,
                    created_at: entryTimestamp,
                    created_by_name: this.currentUsername
                });
                
                await updateDoc(doc(dbFs, 'items', target.id), { stock: newStock });
                this.lastLogId = docRef.id;
                this.lastLogType = 'OUTWARD';
                this.formOutward = { itemId: '', department: 'Indian', qty: '', customDate: '' };
                alert(`Outward deduction logged: -${this.formatStock(qty, target.name)} for "${target.name}".`);
            } catch (error) { 
                alert("Error: " + error.message);
            }
        },

        async undoLastTransaction() {
            if (!this.lastLogId) return alert("No recent log found.");
            if (!confirm(`Revert your last ${this.lastLogType} entry?`)) return;
            try {
                const logsSnap = await getDocs(colRef('logs'));
                const targetingLog = logsSnap.docs.find(d => d.id === this.lastLogId);
                if (!targetingLog) { this.lastLogId = null; return; }
                const logData = targetingLog.data();
                if (!this.isWithin30Minutes(logData.created_at)) return alert("Reversal window expired.");
                const targetItem = this.items.find(i => String(i.id) === String(logData.item_id));
                if (!targetItem) return;
                let logQty = parseFloat(logData.qty) || 0;
                let balanceCorrection = logData.type === 'INWARD' ? Number(targetItem.stock || 0) - logQty : Number(targetItem.stock || 0) + logQty;
                balanceCorrection = Math.round(balanceCorrection * 1000) / 1000;
                if (balanceCorrection < 0) return alert("Rollback denied.");
                await updateDoc(doc(dbFs, 'items', targetItem.id), { stock: balanceCorrection });
                await deleteDoc(doc(dbFs, 'logs', this.lastLogId));
                alert(`Rolled back successfully.`);
                this.lastLogId = null; this.lastLogType = '';
            } catch (e) { alert(e.message); }
        },

        async changeUserRole(userId, role) { await updateDoc(doc(dbFs, 'users', userId), { role }); },
        async deleteUser(userId) { if (confirm('Delete user?')) await deleteDoc(doc(dbFs, 'users', userId)); },
        
        async changeMyPassword() {
            if (this.currentRole !== 'admin') return alert("Only Administrators can modify profiles.");
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
                alert("Operator created.");
            } catch (e) { alert(e.message); }
        },
        
        async promptResetPassword(user) {
            if (this.currentRole !== 'admin') return alert("Denied.");
            let newPass = prompt(`Enter new password for ${user.username} (Min 6 chars):`);
            if (!newPass || newPass.trim().length < 6) return alert("Minimum 6 characters needed.");
            try {
                await updateDoc(doc(dbFs, 'users', user.id), { passwordHash: await sha256(newPass.trim()) });
                alert("Password updated!");
            } catch (error) { alert(error.message); }
        },

        async changeItemName(item) {
            let updatedName = prompt(`[1/3] Update Name:`, item.name);
            if (!updatedName || !updatedName.trim()) return;

            let promptPrice = prompt(`[2/3] Unit Price (MRP):`, item.mrp || 0);
            let finalPrice = Number(promptPrice) || 0;

            try {
                await updateDoc(doc(dbFs, 'items', item.id), { name: updatedName.trim(), mrp: finalPrice });
                alert("Updated cleanly.");
            } catch (e) { alert(e.message); }
        },

        async modifyThreshold(item) {
            let promptVal = prompt('Update safety limit:', item.threshold);
            if (promptVal !== null) await updateDoc(doc(dbFs, 'items', item.id), { threshold: parseFloat(promptVal) || 0 });
        },

        async purgeItem(id) { if (confirm('Purge item entry?')) await deleteDoc(doc(dbFs, 'items', id)); },

        async shiftOrder(id, direction) {
            const sorted = [...this.items].sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
            const idx = sorted.findIndex((i) => i.id === id); if (idx === -1) return;
            const swapIdx = idx + (direction === 'up' ? -1 : 1); if (swapIdx < 0 || swapIdx >= sorted.length) return;
            await updateDoc(doc(dbFs, 'items', sorted[idx].id), { order_index: sorted[swapIdx].order_index || 0 });
            await updateDoc(doc(dbFs, 'items', sorted[swapIdx].id), { order_index: sorted[swapIdx].order_index || 0 });
        },

        async submitNewItem() {
            if (!this.newItemForm.name.trim() || !this.newItemForm.categoryId || !this.newItemForm.supplierName) return alert("Please map all fields.");
            const maxOrder = this.items.reduce((m, i) => Math.max(m, i.order_index || 0), 0);
            await addDoc(colRef('items'), { name: this.newItemForm.name.trim(), category_id: this.newItemForm.categoryId, supplier_name: this.newItemForm.supplierName, stock: 0, threshold: this.newItemForm.threshold || 0, mrp: Number(this.newItemForm.mrp || 0), order_index: maxOrder + 1 });
            this.newItemForm = { name: '', categoryId: '', supplierName: '', threshold: 0, mrp: '' };
            this.showNewItemModal = false;
        },

        downloadInwardSupplierReport() {
            const inwards = this.allRawLogs.filter(l => l.type === 'INWARD' && l.created_at);
            if (!inwards.length) return alert("No inward data available.");
            const wb = XLSX.utils.book_new();
            const dateGroups = {};
            inwards.forEach(log => {
                const dateKey = log.created_at.slice(0, 10);
                if (!dateGroups[dateKey]) dateGroups[dateKey] = [];
                dateGroups[dateKey].push(log);
            });
            Object.keys(dateGroups).sort().forEach(dateStr => {
                const sheetMatrix = [["ITEM NAME", "QUANTITY RECEIVED", "UNIT PRICE", "TOTAL VALUATION"]];
                dateGroups[dateStr].forEach(log => {
                    const linkedItem = this.items.find(i => String(i.id) === String(log.item_id)) || {};
                    const qty = parseFloat(log.qty) || 0;
                    const price = parseFloat(linkedItem.mrp) || 0;
                    sheetMatrix.push([log.item_name || linkedItem.name, this.formatStock(qty, log.item_name || linkedItem.name), `₹${price}`, `₹${qty * price}`]);
                });
                const ws = XLSX.utils.aoa_to_sheet(sheetMatrix);
                XLSX.utils.book_append_sheet(wb, ws, dateStr);
            });
            XLSX.writeFile(wb, `Inward_Report_${new Date().toISOString().slice(0,10)}.xlsx`);
        },

        downloadExcelReport() {
            const getLocalDateString = (offsetDays) => { const d = new Date(); d.setDate(d.getDate() - offsetDays); return d.toISOString().slice(0, 10); };
            const targetDays = Array.from({length: 30}, (_, i) => getLocalDateString(i));
            const headerRow = ["ITEM NAME", "CURRENT STOCK", ...targetDays];
            const matrixData = [headerRow];
            this.processedItems.forEach(item => {
                const row = [item.name, this.formatStock(item.stock, item.name)];
                targetDays.forEach(dateStr => {
                    const inQty = this.allRawLogs.filter(l => l.created_at?.slice(0, 10) === dateStr && String(l.item_id) === String(item.id) && l.type === 'INWARD').reduce((s, l) => s + (parseFloat(l.qty) || 0), 0);
                    const outQty = this.allRawLogs.filter(l => l.created_at?.slice(0, 10) === dateStr && String(l.item_id) === String(item.id) && l.type === 'OUTWARD').reduce((s, l) => s + (parseFloat(l.qty) || 0), 0);
                    row.push(`+${this.formatStock(inQty, item.name)} / -${this.formatStock(outQty, item.name)}`);
                });
                matrixData.push(row);
            });
            const ws = XLSX.utils.aoa_to_sheet(matrixData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "30-Day Ledger");
            XLSX.writeFile(wb, `Stock_Report_${getLocalDateString(0)}.xlsx`);
        }
    };
}

window.stockApp = stockAppDefinition;
if (window.Alpine) {
    window.Alpine.data('stockApp', stockAppDefinition);
} else {
    document.addEventListener('alpine:init', () => {
        window.Alpine.data('stockApp', stockAppDefinition);
    });
}
