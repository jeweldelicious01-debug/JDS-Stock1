import { dbFs } from './firebase-config.js';[cite: 4]
import {
    collection,
    doc,
    getDocs,
    setDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';[cite: 4]

const SESSION_KEY = 'restaurantStockSession_v1';[cite: 4]
const colRef = (name) => collection(dbFs, name);[cite: 4]

async function sha256(text) {
    const enc = new TextEncoder().encode(text);[cite: 4]
    const hashBuf = await crypto.subtle.digest('SHA-256', enc);[cite: 4]
    return Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, '0')).join('');[cite: 4]
}

// Service Worker for Mobile Notifications
let swRegistration = null;
if (typeof window !== 'undefined' && 'serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
        swRegistration = reg;
    }).catch((err) => console.warn('Service Worker registration skipped:', err));
}

// Push & System Notification Dispatcher
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

// Extract pack size and unit details from item name
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

// Inward / Outward Input Parser
function parseQuantityInput(inputStr, itemName = "") {
    if (typeof inputStr === 'number') inputStr = String(inputStr);
    if (!inputStr || !String(inputStr).trim()) return NaN;

    const str = String(inputStr).trim().toLowerCase();
    const pack = getItemPackDetails(itemName);
    const itemUnit = (pack.unit || "").toLowerCase();
    const isKgItem = /\b(kg|kgs|kilo|kilograms?)\b/i.test(itemUnit) || /\b(kg|kgs|kilo|kilograms?)\b/i.test(itemName);
    const isGramItem = /\b(g|gm|gms|gram|grams)\b/i.test(itemUnit) && !isKgItem;
    const isLiterItem = /\b(l|ltr|liter|liters|litre)\b/i.test(itemUnit) || /\b(l|ltr|liter|liters|litre)\b/i.test(itemName);

    // 1. Compound Input: "5kg 250g"
    const compoundKgG = str.match(/^([\d.]+)\s*(?:kg|kgs|kilo|kilograms?)\s*([\d.]+)\s*(?:g|gm|gms|gram|grams)$/);
    if (compoundKgG) {
        const k = parseFloat(compoundKgG[1]) || 0;
        const g = parseFloat(compoundKgG[2]) || 0;
        return Math.round((k + g / 1000) * 1000) / 1000;
    }

    // 2. Explicit Grams
    const gramMatch = str.match(/^([\d.]+)\s*(g|gm|gms|gram|grams)$/);
    if (gramMatch) {
        const grams = parseFloat(gramMatch[1]);
        if (isKgItem) return Math.round((grams / 1000) * 1000) / 1000;
        return grams;
    }

    // 3. Explicit Kilograms
    const kgMatch = str.match(/^([\d.]+)\s*(kg|kgs|kilo|kilograms)$/);
    if (kgMatch) {
        const kgs = parseFloat(kgMatch[1]);
        if (isGramItem) return Math.round(kgs * 1000);
        return kgs;
    }

    // 4. Explicit Milliliters
    const mlMatch = str.match(/^([\d.]+)\s*(ml|milliliters?)$/);
    if (mlMatch) {
        const ml = parseFloat(mlMatch[1]);
        if (isLiterItem) return Math.round((ml / 1000) * 1000) / 1000;
        return ml;
    }

    // 5. Explicit Liters
    const literMatch = str.match(/^([\d.]+)\s*(l|ltr|liter|liters|litre)$/);
    if (literMatch) {
        return parseFloat(literMatch[1]);
    }

    // 6. Direct Decimal Number
    if (str.includes('.')) {
        const decimalNum = parseFloat(str.replace(/[^0-9.]/g, ''));
        return isNaN(decimalNum) ? NaN : Math.round(decimalNum * 1000) / 1000;
    }

    // 7. Bare Number (Multiplies by pack size)
    const rawNum = parseFloat(str.replace(/[^0-9.]/g, ''));
    if (isNaN(rawNum)) return NaN;

    if (pack.hasPack && pack.packSize > 0) {
        return Math.round(rawNum * pack.packSize * 1000) / 1000;
    }

    return rawNum;
}

// Unit & Combined Representation Formatter
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
        const usersSnap = await getDocs(colRef('users'));[cite: 4]
        if (usersSnap.empty) {[cite: 4]
            const adminHash = await sha256('ChangeMe123!');[cite: 4]
            await setDoc(doc(dbFs, 'users', 'admin-seed'), { username: 'admin', passwordHash: adminHash, role: 'admin' });[cite: 4]
            await setDoc(doc(dbFs, 'users', 'order-seed'), { username: 'order', passwordHash: await sha256('Order123!'), role: 'order' });[cite: 4]
            await setDoc(doc(dbFs, 'users', 'inward-seed'), { username: 'inward', passwordHash: await sha256('Inward123!'), role: 'inward' });[cite: 4]
        }

        const catSnap = await getDocs(colRef('categories'));[cite: 4]
        if (catSnap.size < 13) {[cite: 4]
            const defaultCategories = [
                { id: 'kirana', name: 'Kirana', emoji: '🛒', bg_color: '#f8fafc', border_color: '#64748b', text_color: '#334151' },[cite: 4]
                { id: 'frozen', name: 'Frozen', emoji: '❄️', bg_color: '#ecfeff', border_color: '#06b6d4', text_color: '#083344' },[cite: 4]
                { id: 'masala', name: 'Masala', emoji: '🍛', bg_color: '#fff7ed', border_color: '#f97316', text_color: '#7c2d12' },[cite: 4]
                { id: 'grain', name: 'Grain', emoji: '🌾', bg_color: '#fefce8', border_color: '#eab308', text_color: '#713f12' },[cite: 4]
                { id: 'vegetables', name: 'Vegetables', emoji: '🥦', bg_color: '#f0fdf4', border_color: '#22c55e', text_color: '#14532d' },[cite: 4]
                { id: 'bottle', name: 'Bottle', emoji: '🍾', bg_color: '#f5f5f4', border_color: '#737367', text_color: '#1c1917' },[cite: 4]
                { id: 'pasta', name: 'Pasta', emoji: '🍝', bg_color: '#fffbeb', border_color: '#f59e0b', text_color: '#78350f' },[cite: 4]
                { id: 'dairy', name: 'Dairy', emoji: '🥛', bg_color: '#eff6ff', border_color: '#3b82f6', text_color: '#1e40af' },[cite: 4]
                { id: 'disposables', name: 'Disposables', emoji: '🥤', bg_color: '#fafafa', border_color: '#a3a3a3', text_color: '#171717' },[cite: 4]
                { id: 'flour', name: 'Flour', emoji: '🥡', bg_color: '#fdf6f0', border_color: '#cca47c', text_color: '#4a3319' },[cite: 4]
                { id: 'tin', name: 'Tin', emoji: '🥫', bg_color: '#f0fdfa', border_color: '#14b8a6', text_color: '#115e59' },[cite: 4]
                { id: 'khademasala', name: 'KhadeMasala', emoji: '🌶️', bg_color: '#fff1f2', border_color: '#f43f5e', text_color: '#4c0519' },[cite: 4]
                { id: 'beverages', name: 'Beverages', emoji: '🧃', bg_color: '#fdf2f8', border_color: '#ec4899', text_color: '#701a75' }[cite: 4]
            ];
            for (const cat of defaultCategories) {
                await setDoc(doc(dbFs, 'categories', cat.id), { name: cat.name, emoji: cat.emoji, bg_color: cat.bg_color, border_color: cat.border_color, text_color: cat.text_color });[cite: 4]
            }
        }

        const supSnap = await getDocs(colRef('suppliers'));[cite: 4]
        if (supSnap.empty) {[cite: 4]
            await addDoc(colRef('suppliers'), { name: 'Laxmi Traders', phone: '919999999999' });[cite: 4]
            await addDoc(colRef('suppliers'), { name: 'Balaji Food Products', phone: '918888888888' });[cite: 4]
        }
    } catch (e) {
        console.warn("Seeding bypassed: ", e);[cite: 4]
    }
}

export function stockAppDefinition() {
    return {
        categories: [],[cite: 4]
        items: [],[cite: 4]
        cateringEvents: [],  [cite: 4]
        logs: [],[cite: 4]
        allRawLogs: [],[cite: 4]
        users: [],[cite: 4]
        suppliers: [], [cite: 4]
        purchaseOrders: [], [cite: 4]
        
        ready: true,
        isAuthenticated: false,[cite: 4]
        authChecking: false,
        currentRole: 'readonly',[cite: 4]
        currentUsername: '',[cite: 4]
        currentUserId: null,[cite: 4]
        filterCat: 'all',[cite: 4]
        filterSupplier: 'all',[cite: 4]
        orderViewTab: 'pending', [cite: 4]
        
        loginForm: { username: '', password: '' },[cite: 4]
        loginError: '',[cite: 4]
        formInward: { itemId: '', qty: '', supplierName: '', customDate: '' }, [cite: 4]
        formOutward: { itemId: '', department: 'Indian', qty: '', customDate: '' },[cite: 4]

        cateringForm: { partyName: '', paxCount: '', rawTextMenu: '' },[cite: 4]
        cateringModal: { show: false, label: '', text: '' },[cite: 4]
        editingEventId: null,[cite: 4]
        
        orderDesk: {
            supplierId: '',[cite: 4]
            selectedItemId: '',[cite: 4]
            selectedQty: '',[cite: 4]
            basket: [] [cite: 4]
        }, 
        
        lastLogId: null,[cite: 4]
        lastLogType: '',[cite: 4]
        
        showNewItemModal: false,[cite: 4]
        showAccountModal: false,[cite: 4]
        showUserAdminModal: false,[cite: 4]
        
        newItemForm: { name: '', categoryId: '', supplierName: '', threshold: 0, mrp: '' }, [cite: 4]
        newCategoryForm: { name: '', emoji: '📦', paletteIndex: 0 },[cite: 4]
        paletteOptions: [
            { bg: '#eff6ff', border: '#3b82f6', text: '#1e40af' }, [cite: 4]
            { bg: '#fffbeb', border: '#f59e0b', text: '#92400e' }, [cite: 4]
            { bg: '#f0fdf4', border: '#22c55e', text: '#166534' }, [cite: 4]
            { bg: '#faf5ff', border: '#a855f7', text: '#6b21a8' }, [cite: 4]
            { bg: '#fdf2f8', border: '#ec4899', text: '#9d174d' },[cite: 4]
            { bg: '#f8fafc', border: '#64748b', text: '#334151' }[cite: 4]
        ],

        accountForm: { currentPassword: '', newPassword: '' },[cite: 4]
        accountError: '',[cite: 4]
        accountSuccess: '',[cite: 4]
        newUserForm: { username: '', password: '', role: 'inward' },[cite: 4]
        newUserError: '',[cite: 4]
        departments: ['Chinese', 'Indian', 'South Indian', 'Gujarati', 'Continental', 'Tandoor'],[cite: 4]

        formatStock(stock, itemName = "") {
            return formatStockDisplay(stock, itemName);
        },

        async init() {
            this.restoreSession();[cite: 4]

            try {
                await seedIfEmpty();[cite: 4]
            } catch (err) {
                console.warn("Seeding error:", err);
            }
            
            onSnapshot(colRef('categories'), (snap) => { this.categories = snap.docs.map((d) => ({ id: d.id, ...d.data() })); });[cite: 4]
            onSnapshot(colRef('items'), (snap) => { this.items = snap.docs.map((d) => ({ id: d.id, ...d.data() })); });[cite: 4]
            onSnapshot(colRef('suppliers'), (snap) => { this.suppliers = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a,b) => a.name.localeCompare(b.name)); });[cite: 4]

            onSnapshot(colRef('purchase_orders'), (snap) => {[cite: 4]
                this.purchaseOrders = snap.docs.map((d) => ({ id: d.id, ...d.data() }))[cite: 4]
                    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));[cite: 4]
            });
            
            let isInitialEventLoad = true;
            onSnapshot(colRef('catering_events'), (snap) => { [cite: 4]
                const events = snap.docs.map((d) => ({ id: d.id, ...d.data() })); [cite: 4]
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
                this.cateringEvents = events;[cite: 4]
                isInitialEventLoad = false;
            });

            onSnapshot(colRef('logs'), (snap) => { [cite: 4]
                this.allRawLogs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));[cite: 4]
                const todayStr = new Date().toISOString().slice(0, 10);[cite: 4]
                
                this.logs = [...this.allRawLogs][cite: 4]
                    .filter((l) => l.created_at && l.created_at.slice(0, 10) === todayStr)[cite: 4]
                    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[cite: 4]
                    .slice(0, 50)[cite: 4]
                    .map((l) => {[cite: 4]
                        const matchedItem = this.items.find((i) => String(i.id) === String(l.item_id));[cite: 4]
                        return { ...l, item_name: matchedItem ? matchedItem.name : 'Unknown' };[cite: 4]
                    });
            });

            onSnapshot(colRef('users'), (snap) => {[cite: 4]
                this.users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));[cite: 4]
                if (this.currentUserId) {[cite: 4]
                    const me = this.users.find((u) => u.id === this.currentUserId);[cite: 4]
                    if (!me) this.logout();[cite: 4]
                    else { this.currentRole = me.role; this.currentUsername = me.username; }[cite: 4]
                }
                this.restoreSession();[cite: 4]
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
                const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');[cite: 4]
                if (session && session.userId) {[cite: 4]
                    this.currentUserId = session.userId;
                    this.isAuthenticated = true;[cite: 4]
                    if (this.users && this.users.length) {
                        const user = this.users.find((u) => u.id === session.userId);[cite: 4]
                        if (user) {[cite: 4]
                            this.currentUsername = user.username;[cite: 4]
                            this.currentRole = user.role;[cite: 4]
                        }
                    }
                }
            } catch (e) {
                console.warn(e);
            }
        },

        async verifyLogin() {
            this.loginError = '';[cite: 4]
            const { username, password } = this.loginForm;[cite: 4]
            if (!username || !password) { this.loginError = 'Fields required'; return; }[cite: 4]
            const user = this.users.find((u) => u.username.toLowerCase() === username.trim().toLowerCase());[cite: 4]
            if (!user || (await sha256(password)) !== user.passwordHash) { this.loginError = 'Invalid credentials'; return; }[cite: 4]
            this.currentUserId = user.id; this.currentUsername = user.username; this.currentRole = user.role; this.isAuthenticated = true;[cite: 4]
            this.loginForm.password = '';[cite: 4]
            sessionStorage.setItem(SESSION_KEY, JSON.stringify({ userId: user.id }));[cite: 4]
        },

        logout() { 
            sessionStorage.removeItem(SESSION_KEY); [cite: 4]
            this.isAuthenticated = false; [cite: 4]
            this.currentRole = 'readonly';  [cite: 4]
            this.currentUsername = '';  [cite: 4]
            this.currentUserId = null; [cite: 4]
            window.location.reload();[cite: 4]
        },

        get processedItems() {
            let dataset = this.items.map((i) => {[cite: 4]
                const cat = this.categories.find((c) => c.id === i.category_id) || {};[cite: 4]
                return { ...i, category_name: cat.name || 'Unassigned', emoji: cat.emoji || '📦', bg: cat.bg_color || '#f3f4f6', border: cat.border_color || '#9ca3af', text_color: cat.text_color || '#374151' };[cite: 4]
            });

            if (this.filterCat !== 'all') {[cite: 4]
                dataset = dataset.filter((i) => i.category_name === this.filterCat);[cite: 4]
            }

            if (this.filterSupplier !== 'all') {[cite: 4]
                const defaultSupplier = this.suppliers[0] ? this.suppliers[0].name : '';[cite: 4]
                dataset = dataset.filter((i) => (i.supplier_name || defaultSupplier) === this.filterSupplier);[cite: 4]
            }

            return dataset.sort((a, b) => {[cite: 4]
                let aAlert = a.stock <= a.threshold ? 1 : 0; let bAlert = b.stock <= b.threshold ? 1 : 0;[cite: 4]
                if (aAlert !== bAlert) return bAlert - aAlert;[cite: 4]
                return (a.order_index || 0) - (b.order_index || 0);[cite: 4]
            });
        },

        get filteredInwardItems() {
            if (!this.formInward.supplierName) return [];[cite: 4]
            const defaultSupplier = this.suppliers[0] ? this.suppliers[0].name : '';[cite: 4]
            return this.items.filter(i => {[cite: 4]
                const itemSupplier = i.supplier_name || defaultSupplier;[cite: 4]
                return itemSupplier === this.formInward.supplierName;[cite: 4]
            });
        },

        get filteredOrderDeskItems() {
            if (!this.orderDesk.supplierId) return [];[cite: 4]
            const vendor = this.suppliers.find(s => String(s.id) === String(this.orderDesk.supplierId));[cite: 4]
            if (!vendor) return [];[cite: 4]
            const defaultSupplier = this.suppliers[0] ? this.suppliers[0].name : '';[cite: 4]
            return this.items.filter(i => {[cite: 4]
                const itemSupplier = i.supplier_name || defaultSupplier;[cite: 4]
                return itemSupplier === vendor.name;[cite: 4]
            });
        },

        get processedPurchaseOrders() {
            const currentStatusTab = String(this.orderViewTab).toLowerCase();[cite: 4]
            return this.purchaseOrders.filter(o => {[cite: 4]
                const orderStatus = String(o.status).toLowerCase();[cite: 4]
                if (currentStatusTab === 'pending') {[cite: 4]
                    return orderStatus === 'pending';[cite: 4]
                } else {
                    return orderStatus !== 'pending';[cite: 4]
                }
            });
        },

        getEventsForDate(dateStr) {
            if (!dateStr || !this.cateringEvents) return [];[cite: 4]
            return this.cateringEvents.filter(ev => String(ev.date) === String(dateStr));[cite: 4]
        },

        getEventCountForDate(dateStr) {
            return this.getEventsForDate(dateStr).length;[cite: 4]
        },

        viewCateringTextMenu(eventObj) {
            this.cateringModal.label = `${eventObj.partyName} (${eventObj.paxCount} Pax)`;[cite: 4]
            this.cateringModal.text = eventObj.menuText;[cite: 4]
            this.cateringModal.show = true;[cite: 4]
        },

        clearCateringForm() {
            this.cateringForm.partyName = '';[cite: 4]
            this.cateringForm.paxCount = '';[cite: 4]
            this.cateringForm.rawTextMenu = '';[cite: 4]
            this.editingEventId = null;[cite: 4]
        },

        editCateringEvent(eventObj) {
            this.cateringForm.partyName = eventObj.partyName;[cite: 4]
            this.cateringForm.paxCount = eventObj.paxCount;[cite: 4]
            this.cateringForm.rawTextMenu = eventObj.menuText;[cite: 4]
            this.editingEventId = eventObj.id;[cite: 4]
        },

        async deleteCateringEvent(eventId) {
            if (!confirm("Are you sure you want to delete this event?")) return;[cite: 4]
            try {
                await deleteDoc(doc(dbFs, "catering_events", eventId));[cite: 4]
                this.cateringEvents = this.cateringEvents.filter(e => e.id !== eventId);[cite: 4]
                alert("Event deleted successfully.");[cite: 4]
            } catch (err) {
                alert("Operation failed: " + err.message);[cite: 4]
            }
        },

        async submitDirectTextCatering(dateString) {
            if (!this.cateringForm.partyName || !this.cateringForm.rawTextMenu) {[cite: 4]
                alert("Please fill out the party title and paste menu text.");[cite: 4]
                return;[cite: 4]
            }

            const payload = {
                date: dateString,[cite: 4]
                partyName: this.cateringForm.partyName.trim(),[cite: 4]
                paxCount: Number(this.cateringForm.paxCount) || 0,[cite: 4]
                menuText: this.cateringForm.rawTextMenu,[cite: 4]
                updated_at: Date.now()[cite: 4]
            };

            try {
                if (this.editingEventId) {[cite: 4]
                    await setDoc(doc(dbFs, "catering_events", this.editingEventId), payload, { merge: true });[cite: 4]
                    const idx = this.cateringEvents.findIndex(e => e.id === this.editingEventId);[cite: 4]
                    if (idx !== -1) this.cateringEvents[idx] = { id: this.editingEventId, ...payload };[cite: 4]
                    this.editingEventId = null;[cite: 4]
                    alert("Function updated successfully!");[cite: 4]
                } else {
                    payload.created_at = Date.now();[cite: 4]
                    const docRef = await addDoc(colRef('catering_events'), payload);[cite: 4]
                    payload.id = docRef.id;[cite: 4]
                    this.cateringEvents = [...this.cateringEvents, payload];[cite: 4]
                    alert("Fresh function logged successfully!");[cite: 4]
                }
                this.clearCateringForm();[cite: 4]
            } catch (err) {
                alert("Save failure: " + err.message);[cite: 4]
            }
        },

        addItemToOrder() {
            if (!this.orderDesk.selectedItemId || !this.orderDesk.selectedQty || this.orderDesk.selectedQty <= 0) {[cite: 4]
                alert("Select product and enter valid quantity.");[cite: 4]
                return;[cite: 4]
            }
            const itemObj = this.items.find(i => i.id === this.orderDesk.selectedItemId);[cite: 4]
            if (!itemObj) return;[cite: 4]

            this.orderDesk.basket.push({[cite: 4]
                id: itemObj.id,[cite: 4]
                name: itemObj.name,[cite: 4]
                qty: Number(this.orderDesk.selectedQty)[cite: 4]
            });
            this.orderDesk.selectedItemId = '';[cite: 4]
            this.orderDesk.selectedQty = '';[cite: 4]
        },

        removeOrderBasketItem(index) {
            this.orderDesk.basket.splice(index, 1);[cite: 4]
        },

        sendWhatsAppOrder() {
            if (!this.orderDesk.supplierId || this.orderDesk.basket.length === 0) {[cite: 4]
                alert("Select supplier and add items to purchase basket.");[cite: 4]
                return;[cite: 4]
            }
            const supplierObj = this.suppliers.find(s => s.id === this.orderDesk.supplierId);[cite: 4]
            const supplierName = supplierObj ? supplierObj.name : "Supplier";[cite: 4]
            const tomorrow = new Date();[cite: 4]
            tomorrow.setDate(tomorrow.getDate() + 1);[cite: 4]

            let messageLines = [
                `*PURCHASE ORDER: ${supplierName.toUpperCase()}*`,[cite: 4]
                `*Date:* ${tomorrow.toLocaleDateString('en-GB')}`,[cite: 4]
                `--------------------------------`[cite: 4]
            ];

            this.orderDesk.basket.forEach((item, index) => {[cite: 4]
                messageLines.push(`${index + 1}. *${item.name} - Qty: ${item.qty}*`);[cite: 4]
            });

            window.open(`https://wa.me/?text=${encodeURIComponent(messageLines.join('\n'))}`, '_blank');[cite: 4]
        },

        async approveIncomingOrder(order) {
            if (order.status !== 'PENDING') return;[cite: 4]
            if (!confirm(`Confirm stock ingestion from ${order.supplier_name}?`)) return;[cite: 4]

            try {
                for (let record of order.items) {[cite: 4]
                    const arrivedQty = parseFloat(record.qty) || 0;
                    const targetItem = this.items.find(i => String(i.id) === String(record.id));[cite: 4]
                    if (targetItem && arrivedQty > 0) {
                        const newStock = Math.round((Number(targetItem.stock || 0) + arrivedQty) * 1000) / 1000;
                        await updateDoc(doc(dbFs, 'items', targetItem.id), { stock: newStock });[cite: 4]
                        await addDoc(colRef('logs'), { type: 'INWARD', item_id: targetItem.id, qty: arrivedQty, supplier_name: order.supplier_name, department: null, created_at: new Date().toISOString(), created_by_name: this.currentUsername });[cite: 4]
                    }
                }
                await updateDoc(doc(dbFs, 'purchase_orders', order.id), { status: 'RECEIVED', items: order.items, resolved_at: new Date().toISOString(), resolved_by: this.currentUsername });[cite: 4]
                alert("Order approved and balances synchronized.");[cite: 4]
            } catch (error) { alert("Error: " + error.message); }[cite: 4]
        },

        async declineIncomingOrder(order) {
            if (order.status !== 'PENDING') return;[cite: 4]
            if (!confirm(`Cancel order from ${order.supplier_name}?`)) return;[cite: 4]
            try {
                await updateDoc(doc(dbFs, 'purchase_orders', order.id), { status: 'DECLINED', resolved_at: new Date().toISOString(), resolved_by: this.currentUsername });[cite: 4]
                alert("Order canceled.");[cite: 4]
            } catch (error) { alert("Error: " + error.message); }[cite: 4]
        },

        isWithin30Minutes(createdAt) {
            if (!createdAt) return false;[cite: 4]
            return (new Date() - new Date(createdAt)) < 1800000;[cite: 4]
        },

        async triggerUndo(log) {
            if (!this.isWithin30Minutes(log.created_at)) return alert("Reversal window (30 min) expired.");[cite: 4]
            if (!confirm("Revert this entry?")) return;[cite: 4]
            try {
                const targetItem = this.items.find(i => String(i.id) === String(log.item_id));[cite: 4]
                if (!targetItem) return alert("Item no longer exists.");[cite: 4]
                let currentBal = Number(targetItem.stock || 0);[cite: 4]
                let logQty = parseFloat(log.qty) || 0;
                let corrected = log.type === 'INWARD' ? currentBal - logQty : currentBal + logQty;[cite: 4]
                corrected = Math.round(corrected * 1000) / 1000;
                if (corrected < 0) return alert("Stock cannot drop below zero.");[cite: 4]
                await updateDoc(doc(dbFs, 'items', targetItem.id), { stock: corrected });[cite: 4]
                await deleteDoc(doc(dbFs, 'logs', log.id));[cite: 4]
                alert("Transaction rolled back successfully!");[cite: 4]
            } catch(e) { alert("Error: " + e.message); }[cite: 4]
        },

        async addInward() {
            if (!this.formInward.itemId || !this.formInward.qty || !this.formInward.supplierName) return alert('Select missing fields.');[cite: 4]
            const target = this.items.find((i) => String(i.id) === String(this.formInward.itemId));[cite: 4]
            if (!target) return alert('Selected item not found.');[cite: 4]
            
            const qty = parseQuantityInput(this.formInward.qty, target.name); 
            if (isNaN(qty) || qty <= 0) return alert('Enter a valid quantity (e.g. 1, 1.25kg, 1250g, 5kg 250g).');
            
            let vendor = this.formInward.supplierName.trim();[cite: 4]
            if (vendor === "_NEW_") {[cite: 4]
                let newVendorName = prompt("Enter new Supplier Name:");[cite: 4]
                if (!newVendorName || !newVendorName.trim()) return alert("Supplier name required.");[cite: 4]
                vendor = newVendorName.trim();[cite: 4]
                const matchEx = this.suppliers.find(s => s.name.toLowerCase() === vendor.toLowerCase());[cite: 4]
                if (!matchEx) await addDoc(colRef('suppliers'), { name: vendor, phone: '' });[cite: 4]
            }

            let entryTimestamp = new Date().toISOString();[cite: 4]
            if (this.currentRole === 'admin' && this.formInward.customDate) {[cite: 4]
                entryTimestamp = new Date(this.formInward.customDate).toISOString();[cite: 4]
            }

            try {
                const newStock = Math.round((Number(target.stock || 0) + qty) * 1000) / 1000;
                await updateDoc(doc(dbFs, 'items', target.id), { stock: newStock });[cite: 4]
                const docRef = await addDoc(colRef('logs'), {[cite: 4]
                    type: 'INWARD',[cite: 4]
                    item_id: target.id,[cite: 4]
                    qty, 
                    supplier_name: vendor,[cite: 4]
                    department: null,[cite: 4]
                    created_at: entryTimestamp,[cite: 4]
                    created_by_name: this.currentUsername[cite: 4]
                });
                
                this.lastLogId = docRef.id;[cite: 4]
                this.lastLogType = 'INWARD';[cite: 4]
                this.formInward = { itemId: '', qty: '', supplierName: '', customDate: '' };[cite: 4]
                alert(`Inward recorded: +${this.formatStock(qty, target.name)} for "${target.name}".`);
            } catch (error) { 
                alert("Write error: " + error.message);[cite: 4]
            }
        },

        async deductOutward() {
            if (!this.formOutward.itemId || !this.formOutward.qty) return alert('Select missing fields.');[cite: 4]
            const target = this.items.find((i) => String(i.id) === String(this.formOutward.itemId));[cite: 4]
            if (!target) return alert('Item not found.');[cite: 4]
            
            const qty = parseQuantityInput(this.formOutward.qty, target.name); 
            if (isNaN(qty) || qty <= 0) return alert('Enter a valid quantity (e.g. 1, 0.5kg, 500g, 5).');
            if (Number(target.stock || 0) < qty) return alert(`Insufficient stock. Current balance is ${this.formatStock(target.stock, target.name)}.`);

            let entryTimestamp = new Date().toISOString();[cite: 4]
            if (this.currentRole === 'admin' && this.formOutward.customDate) {[cite: 4]
                entryTimestamp = new Date(this.formOutward.customDate).toISOString();[cite: 4]
            }

            try {
                const newStock = Math.round((Number(target.stock) - qty) * 1000) / 1000;
                const docRef = await addDoc(colRef('logs'), {[cite: 4]
                    type: 'OUTWARD',[cite: 4]
                    item_id: target.id,[cite: 4]
                    qty, 
                    department: this.formOutward.department,[cite: 4]
                    created_at: entryTimestamp,[cite: 4]
                    created_by_name: this.currentUsername[cite: 4]
                });
                
                await updateDoc(doc(dbFs, 'items', target.id), { stock: newStock });[cite: 4]
                this.lastLogId = docRef.id;[cite: 4]
                this.lastLogType = 'OUTWARD';[cite: 4]
                this.formOutward = { itemId: '', department: 'Indian', qty: '', customDate: '' };[cite: 4]
                alert(`Outward deduction logged: -${this.formatStock(qty, target.name)} for "${target.name}".`);
            } catch (error) { 
                alert("Error: " + error.message);[cite: 4]
            }
        },

        async undoLastTransaction() {
            if (!this.lastLogId) return alert("No recent log found.");[cite: 4]
            if (!confirm(`Revert your last ${this.lastLogType} entry?`)) return;[cite: 4]
            try {
                const logsSnap = await getDocs(colRef('logs'));[cite: 4]
                const targetingLog = logsSnap.docs.find(d => d.id === this.lastLogId);[cite: 4]
                if (!targetingLog) { this.lastLogId = null; return; }[cite: 4]
                const logData = targetingLog.data();[cite: 4]
                if (!this.isWithin30Minutes(logData.created_at)) return alert("Reversal window expired.");[cite: 4]
                const targetItem = this.items.find(i => String(i.id) === String(logData.item_id));[cite: 4]
                if (!targetItem) return;[cite: 4]
                let logQty = parseFloat(logData.qty) || 0;
                let balanceCorrection = logData.type === 'INWARD' ? Number(targetItem.stock || 0) - logQty : Number(targetItem.stock || 0) + logQty;[cite: 4]
                balanceCorrection = Math.round(balanceCorrection * 1000) / 1000;
                if (balanceCorrection < 0) return alert("Rollback denied.");[cite: 4]
                await updateDoc(doc(dbFs, 'items', targetItem.id), { stock: balanceCorrection });[cite: 4]
                await deleteDoc(doc(dbFs, 'logs', this.lastLogId));[cite: 4]
                alert(`Rolled back successfully.`);
                this.lastLogId = null; this.lastLogType = '';[cite: 4]
            } catch (e) { alert(e.message); }[cite: 4]
        },

        async changeUserRole(userId, role) { await updateDoc(doc(dbFs, 'users', userId), { role }); },[cite: 4]
        async deleteUser(userId) { if (confirm('Delete user?')) await deleteDoc(doc(dbFs, 'users', userId)); },[cite: 4]
        
        async changeMyPassword() {
            if (this.currentRole !== 'admin') return alert("Only Administrators can modify profiles.");[cite: 4]
            this.accountError = ''; this.accountSuccess = '';[cite: 4]
            const { currentPassword, newPassword } = this.accountForm;[cite: 4]
            if (newPassword.length < 6) { this.accountError = 'Min 6 characters'; return; }[cite: 4]
            const user = this.users.find((u) => u.id === this.currentUserId);[cite: 4]
            if ((await sha256(currentPassword)) !== user.passwordHash) { this.accountError = 'Incorrect password'; return; }[cite: 4]
            await updateDoc(doc(dbFs, 'users', user.id), { passwordHash: await sha256(newPassword) });[cite: 4]
            this.accountSuccess = 'Password updated.';[cite: 4]
            this.accountForm = { currentPassword: '', newPassword: '' };[cite: 4]
        },

        async createUser() {
            const { username, password, role = 'inward' } = this.newUserForm;[cite: 4]
            if (!username || password.length < 6) return alert("Username required and password must be 6+ chars.");[cite: 4]
            try {
                const passwordHash = await sha256(password);[cite: 4]
                await addDoc(colRef('users'), { username: username.trim(), passwordHash, role });[cite: 4]
                this.newUserForm = { username: '', password: '', role: 'inward' };[cite: 4]
                alert("Operator created.");
            } catch (e) { alert(e.message); }[cite: 4]
        },
        
        async promptResetPassword(user) {
            if (this.currentRole !== 'admin') return alert("Denied.");[cite: 4]
            let newPass = prompt(`Enter new password for ${user.username} (Min 6 chars):`);[cite: 4]
            if (!newPass || newPass.trim().length < 6) return alert("Minimum 6 characters needed.");[cite: 4]
            try {
                await updateDoc(doc(dbFs, 'users', user.id), { passwordHash: await sha256(newPass.trim()) });[cite: 4]
                alert("Password updated!");[cite: 4]
            } catch (error) { alert(error.message); }[cite: 4]
        },

        async changeItemName(item) {
            let updatedName = prompt(`[1/3] Update Name:`, item.name);[cite: 4]
            if (!updatedName || !updatedName.trim()) return;[cite: 4]

            let promptPrice = prompt(`[2/3] Unit Price (MRP):`, item.mrp || 0);[cite: 4]
            let finalPrice = Number(promptPrice) || 0;

            try {
                await updateDoc(doc(dbFs, 'items', item.id), { name: updatedName.trim(), mrp: finalPrice });[cite: 4]
                alert("Updated cleanly.");
            } catch (e) { alert(e.message); }[cite: 4]
        },

        async modifyThreshold(item) {
            let promptVal = prompt('Update safety limit:', item.threshold);[cite: 4]
            if (promptVal !== null) await updateDoc(doc(dbFs, 'items', item.id), { threshold: parseFloat(promptVal) || 0 });
        },

        async purgeItem(id) { if (confirm('Purge item entry?')) await deleteDoc(doc(dbFs, 'items', id)); },[cite: 4]

        async shiftOrder(id, direction) {
            const sorted = [...this.items].sort((a, b) => (a.order_index || 0) - (b.order_index || 0));[cite: 4]
            const idx = sorted.findIndex((i) => i.id === id); if (idx === -1) return;[cite: 4]
            const swapIdx = idx + (direction === 'up' ? -1 : 1); if (swapIdx < 0 || swapIdx >= sorted.length) return;[cite: 4]
            await updateDoc(doc(dbFs, 'items', sorted[idx].id), { order_index: sorted[swapIdx].order_index || 0 });[cite: 4]
            await updateDoc(doc(dbFs, 'items', sorted[swapIdx].id), { order_index: sorted[swapIdx].order_index || 0 });[cite: 4]
        },

        async submitNewItem() {
            if (!this.newItemForm.name.trim() || !this.newItemForm.categoryId || !this.newItemForm.supplierName) return alert("Please map all fields.");[cite: 4]
            const maxOrder = this.items.reduce((m, i) => Math.max(m, i.order_index || 0), 0);[cite: 4]
            await addDoc(colRef('items'), { name: this.newItemForm.name.trim(), category_id: this.newItemForm.categoryId, supplier_name: this.newItemForm.supplierName, stock: 0, threshold: this.newItemForm.threshold || 0, mrp: Number(this.newItemForm.mrp || 0), order_index: maxOrder + 1 });[cite: 4]
            this.newItemForm = { name: '', categoryId: '', supplierName: '', threshold: 0, mrp: '' };[cite: 4]
            this.showNewItemModal = false;[cite: 4]
        },

        downloadInwardSupplierReport() {
            const inwards = this.allRawLogs.filter(l => l.type === 'INWARD' && l.created_at);[cite: 4]
            if (!inwards.length) return alert("No inward data available.");[cite: 4]
            const wb = XLSX.utils.book_new();[cite: 4]
            const dateGroups = {};[cite: 4]
            inwards.forEach(log => {[cite: 4]
                const dateKey = log.created_at.slice(0, 10);[cite: 4]
                if (!dateGroups[dateKey]) dateGroups[dateKey] = [];[cite: 4]
                dateGroups[dateKey].push(log);[cite: 4]
            });
            Object.keys(dateGroups).sort().forEach(dateStr => {[cite: 4]
                const sheetMatrix = [["ITEM NAME", "QUANTITY RECEIVED", "UNIT PRICE", "TOTAL VALUATION"]];[cite: 4]
                dateGroups[dateStr].forEach(log => {[cite: 4]
                    const linkedItem = this.items.find(i => String(i.id) === String(log.item_id)) || {};[cite: 4]
                    const qty = parseFloat(log.qty) || 0;
                    const price = parseFloat(linkedItem.mrp) || 0;[cite: 4]
                    sheetMatrix.push([log.item_name || linkedItem.name, this.formatStock(qty, log.item_name || linkedItem.name), `₹${price}`, `₹${qty * price}`]);
                });
                const ws = XLSX.utils.aoa_to_sheet(sheetMatrix);[cite: 4]
                XLSX.utils.book_append_sheet(wb, ws, dateStr);[cite: 4]
            });
            XLSX.writeFile(wb, `Inward_Report_${new Date().toISOString().slice(0,10)}.xlsx`);[cite: 4]
        },

        downloadExcelReport() {
            const getLocalDateString = (offsetDays) => { const d = new Date(); d.setDate(d.getDate() - offsetDays); return d.toISOString().slice(0, 10); };[cite: 4]
            const targetDays = Array.from({length: 30}, (_, i) => getLocalDateString(i));
            const headerRow = ["ITEM NAME", "CURRENT STOCK", ...targetDays];[cite: 4]
            const matrixData = [headerRow];[cite: 4]
            this.processedItems.forEach(item => {[cite: 4]
                const row = [item.name, this.formatStock(item.stock, item.name)];
                targetDays.forEach(dateStr => {[cite: 4]
                    const inQty = this.allRawLogs.filter(l => l.created_at?.slice(0, 10) === dateStr && String(l.item_id) === String(item.id) && l.type === 'INWARD').reduce((s, l) => s + (parseFloat(l.qty) || 0), 0);
                    const outQty = this.allRawLogs.filter(l => l.created_at?.slice(0, 10) === dateStr && String(l.item_id) === String(item.id) && l.type === 'OUTWARD').reduce((s, l) => s + (parseFloat(l.qty) || 0), 0);
                    row.push(`+${this.formatStock(inQty, item.name)} / -${this.formatStock(outQty, item.name)}`);
                });
                matrixData.push(row);[cite: 4]
            });
            const ws = XLSX.utils.aoa_to_sheet(matrixData);[cite: 4]
            const wb = XLSX.utils.book_new();[cite: 4]
            XLSX.utils.book_append_sheet(wb, ws, "30-Day Ledger");[cite: 4]
            XLSX.writeFile(wb, `Stock_Report_${getLocalDateString(0)}.xlsx`);[cite: 4]
        }
    };
}

// Global Alpine Registration
window.stockApp = stockAppDefinition;
if (window.Alpine) {
    window.Alpine.data('stockApp', stockAppDefinition);
} else {
    document.addEventListener('alpine:init', () => {[cite: 4]
        window.Alpine.data('stockApp', stockAppDefinition);
    });
}
