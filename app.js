import { dbFs } from './firebase-config.js'; //[cite: 8]
import {
    collection,
    doc,
    getDocs,
    setDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js'; //[cite: 8]

const SESSION_KEY = 'restaurantStockSession_v1'; //[cite: 8]
const colRef = (name) => collection(dbFs, name); //[cite: 8]

async function sha256(text) {
    const enc = new TextEncoder().encode(text); //[cite: 8]
    const hashBuf = await crypto.subtle.digest('SHA-256', enc); //[cite: 8]
    return Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, '0')).join(''); //[cite: 8]
}

// Safe Service Worker Registration
let swRegistration = null;
if (typeof window !== 'undefined' && 'serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').then((reg) => { //[cite: 8]
        swRegistration = reg; //[cite: 8]
    }).catch((err) => console.warn('Service Worker registration skipped:', err)); //[cite: 8]
}

// Push & System Notification Dispatcher
async function sendBrowserNotification(title, body) {
    if (typeof window === 'undefined' || !("Notification" in window)) return; //[cite: 8]
    if (Notification.permission !== "granted") return; //[cite: 8]

    try {
        if (swRegistration && swRegistration.active) { //[cite: 8]
            swRegistration.showNotification(title, { //[cite: 8]
                body: body, //[cite: 8]
                icon: "https://cdn-icons-png.flaticon.com/512/3081/3081840.png", //[cite: 8]
                badge: "https://cdn-icons-png.flaticon.com/512/3081/3081840.png", //[cite: 8]
                vibrate: [200, 100, 200] //[cite: 8]
            }); //[cite: 8]
        } else {
            new Notification(title, { body: body, icon: "https://cdn-icons-png.flaticon.com/512/3081/3081840.png" }); //[cite: 8]
        }
    } catch (err) {
        console.warn("Notification dispatch error:", err); //[cite: 8]
    }
}

// Extract pack multiplier and unit from item name (e.g. "Sugar Packet 50 kg" -> 50 kg)
function getItemPackDetails(itemName = "") {
    if (!itemName) return { packSize: 1, unit: "", hasPack: false };
    
    const match = itemName.match(/(\d+(?:\.\d+)?)\s*(kg|kgs|kilo|kilograms?|gm|gms|g|grams?|l|ltr|liters?|litres?|ml|pkts?|packets?|pcs?|pieces?|box|boxes|tins?|bottles?|cans?)\b/i);
    if (match) {
        return {
            packSize: parseFloat(match[1]),
            unit: match[2].toLowerCase(),
            hasPack: true
        };
    }

    const unitOnlyMatch = itemName.match(/\b(kg|kgs|kilo|kilograms?|gm|gms|g|grams?|l|ltr|liters?|litres?|ml|pkts?|packets?|pcs?|pieces?|box|boxes|tins?|bottles?|cans?)\b/i);
    if (unitOnlyMatch) {
        return {
            packSize: 1,
            unit: unitOnlyMatch[1].toLowerCase(),
            hasPack: false
        };
    }

    return { packSize: 1, unit: "", hasPack: false };
}

// Parser: multiplies count by pack size or converts unit inputs
function parseQuantityInput(inputStr, itemName = "") {
    if (typeof inputStr === 'number') inputStr = String(inputStr);
    if (!inputStr || !String(inputStr).trim()) return NaN; //[cite: 8]

    const str = String(inputStr).trim().toLowerCase(); //[cite: 8]
    const pack = getItemPackDetails(itemName);
    const itemUnit = (pack.unit || "").toLowerCase();
    const isKgItem = /\b(kg|kgs|kilo|kilograms?)\b/i.test(itemUnit) || /\b(kg|kgs|kilo|kilograms?)\b/i.test(itemName);
    const isGramItem = /\b(g|gm|gms|gram|grams)\b/i.test(itemUnit) && !isKgItem;
    const isLiterItem = /\b(l|ltr|liter|liters|litre)\b/i.test(itemUnit) || /\b(l|ltr|liter|liters|litre)\b/i.test(itemName);

    // 1. Compound Format: "50kg 500g"
    const compoundKgG = str.match(/^([\d.]+)\s*(?:kg|kgs|kilo|kilograms?)\s*([\d.]+)\s*(?:g|gm|gms|gram|grams)$/);
    if (compoundKgG) {
        const k = parseFloat(compoundKgG[1]) || 0;
        const g = parseFloat(compoundKgG[2]) || 0;
        return Math.round((k + g / 1000) * 1000) / 1000;
    }

    // 2. Explicit Grams: "500g", "1250gm"
    const gramMatch = str.match(/^([\d.]+)\s*(g|gm|gms|gram|grams)$/); //[cite: 8]
    if (gramMatch) {
        const grams = parseFloat(gramMatch[1]); //[cite: 8]
        if (isKgItem) return Math.round((grams / 1000) * 1000) / 1000;
        return grams; //[cite: 8]
    }

    // 3. Explicit Kilograms: "1.25kg", "50kg"
    const kgMatch = str.match(/^([\d.]+)\s*(kg|kgs|kilo|kilograms)$/); //[cite: 8]
    if (kgMatch) {
        const kgs = parseFloat(kgMatch[1]); //[cite: 8]
        if (isGramItem) return Math.round(kgs * 1000);
        return kgs; //[cite: 8]
    }

    // 4. Explicit Milliliters: "500ml"
    const mlMatch = str.match(/^([\d.]+)\s*(ml|milliliters?)$/); //[cite: 8]
    if (mlMatch) {
        const ml = parseFloat(mlMatch[1]); //[cite: 8]
        if (isLiterItem) return Math.round((ml / 1000) * 1000) / 1000;
        return ml; //[cite: 8]
    }

    // 5. Explicit Liters: "1.5L", "15L"
    const literMatch = str.match(/^([\d.]+)\s*(l|ltr|liter|liters|litre)$/);
    if (literMatch) {
        return parseFloat(literMatch[1]);
    }

    // 6. Direct Decimal Number: "1.25", "0.5"
    if (str.includes('.')) {
        const decimalNum = parseFloat(str.replace(/[^0-9.]/g, ''));
        return isNaN(decimalNum) ? NaN : Math.round(decimalNum * 1000) / 1000;
    }

    // 7. Bare Integer (Multiplies by pack size: e.g. "1" for "Sugar Packet 50 kg" = 50)
    const rawNum = parseFloat(str.replace(/[^0-9.]/g, '')); //[cite: 8]
    if (isNaN(rawNum)) return NaN; //[cite: 8]

    if (pack.hasPack && pack.packSize > 0) {
        return Math.round(rawNum * pack.packSize * 1000) / 1000;
    }

    return rawNum;
}

// Display stock in readable units (e.g. "50 kg", "50 kg 250 g", "500 g")
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
        const usersSnap = await getDocs(colRef('users')); //[cite: 8]
        if (usersSnap.empty) { //[cite: 8]
            const adminHash = await sha256('ChangeMe123!'); //[cite: 8]
            await setDoc(doc(dbFs, 'users', 'admin-seed'), { username: 'admin', passwordHash: adminHash, role: 'admin' }); //[cite: 8]
            await setDoc(doc(dbFs, 'users', 'order-seed'), { username: 'order', passwordHash: await sha256('Order123!'), role: 'order' }); //[cite: 8]
            await setDoc(doc(dbFs, 'users', 'inward-seed'), { username: 'inward', passwordHash: await sha256('Inward123!'), role: 'inward' }); //[cite: 8]
        }

        const catSnap = await getDocs(colRef('categories')); //[cite: 8]
        if (catSnap.size < 13) { //[cite: 8]
            const defaultCategories = [
                { id: 'kirana', name: 'Kirana', emoji: '🛒', bg_color: '#f8fafc', border_color: '#64748b', text_color: '#334151' }, //[cite: 8]
                { id: 'frozen', name: 'Frozen', emoji: '❄️', bg_color: '#ecfeff', border_color: '#06b6d4', text_color: '#083344' }, //[cite: 8]
                { id: 'masala', name: 'Masala', emoji: '🍛', bg_color: '#fff7ed', border_color: '#f97316', text_color: '#7c2d12' }, //[cite: 8]
                { id: 'grain', name: 'Grain', emoji: '🌾', bg_color: '#fefce8', border_color: '#eab308', text_color: '#713f12' }, //[cite: 8]
                { id: 'vegetables', name: 'Vegetables', emoji: '🥦', bg_color: '#f0fdf4', border_color: '#22c55e', text_color: '#14532d' }, //[cite: 8]
                { id: 'bottle', name: 'Bottle', emoji: '🍾', bg_color: '#f5f5f4', border_color: '#737367', text_color: '#1c1917' }, //[cite: 8]
                { id: 'pasta', name: 'Pasta', emoji: '🍝', bg_color: '#fffbeb', border_color: '#f59e0b', text_color: '#78350f' }, //[cite: 8]
                { id: 'dairy', name: 'Dairy', emoji: '🥛', bg_color: '#eff6ff', border_color: '#3b82f6', text_color: '#1e40af' }, //[cite: 8]
                { id: 'disposables', name: 'Disposables', emoji: '🥤', bg_color: '#fafafa', border_color: '#a3a3a3', text_color: '#171717' }, //[cite: 8]
                { id: 'flour', name: 'Flour', emoji: '🥡', bg_color: '#fdf6f0', border_color: '#cca47c', text_color: '#4a3319' }, //[cite: 8]
                { id: 'tin', name: 'Tin', emoji: '🥫', bg_color: '#f0fdfa', border_color: '#14b8a6', text_color: '#115e59' }, //[cite: 8]
                { id: 'khademasala', name: 'KhadeMasala', emoji: '🌶️', bg_color: '#fff1f2', border_color: '#f43f5e', text_color: '#4c0519' }, //[cite: 8]
                { id: 'beverages', name: 'Beverages', emoji: '🧃', bg_color: '#fdf2f8', border_color: '#ec4899', text_color: '#701a75' } //[cite: 8]
            ];
            for (const cat of defaultCategories) {
                await setDoc(doc(dbFs, 'categories', cat.id), { name: cat.name, emoji: cat.emoji, bg_color: cat.bg_color, border_color: cat.border_color, text_color: cat.text_color }); //[cite: 8]
            }
        }

        const supSnap = await getDocs(colRef('suppliers')); //[cite: 8]
        if (supSnap.empty) { //[cite: 8]
            await addDoc(colRef('suppliers'), { name: 'Laxmi Traders', phone: '919999999999' }); //[cite: 8]
            await addDoc(colRef('suppliers'), { name: 'Balaji Food Products', phone: '918888888888' }); //[cite: 8]
        }
    } catch (e) {
        console.warn("Seeding bypassed: ", e); //[cite: 8]
    }
}

export function stockApp() {
    return {
        categories: [], //[cite: 8]
        items: [], //[cite: 8]
        cateringEvents: [], //[cite: 8]
        logs: [], //[cite: 8]
        allRawLogs: [], //[cite: 8]
        users: [], //[cite: 8]
        suppliers: [], //[cite: 8]
        purchaseOrders: [], //[cite: 8]
        
        ready: true, //[cite: 8]
        isAuthenticated: false, //[cite: 8]
        authChecking: false,
        currentRole: 'readonly', //[cite: 8]
        currentUsername: '', //[cite: 8]
        currentUserId: null, //[cite: 8]
        filterCat: 'all', //[cite: 8]
        filterSupplier: 'all', //[cite: 8]
        orderViewTab: 'pending', //[cite: 8]
        
        loginForm: { username: '', password: '' }, //[cite: 8]
        loginError: '', //[cite: 8]
        formInward: { itemId: '', qty: '', supplierName: '', customDate: '' }, //[cite: 8]
        formOutward: { itemId: '', department: 'Indian', qty: '', customDate: '' }, //[cite: 8]

        cateringForm: { partyName: '', paxCount: '', rawTextMenu: '' }, //[cite: 8]
        cateringModal: { show: false, label: '', text: '' }, //[cite: 8]
        editingEventId: null, //[cite: 8]
        
        orderDesk: {
            supplierId: '', //[cite: 8]
            selectedItemId: '', //[cite: 8]
            selectedQty: '', //[cite: 8]
            basket: [] //[cite: 8]
        }, 
        
        lastLogId: null, //[cite: 8]
        lastLogType: '', //[cite: 8]
        
        showNewItemModal: false, //[cite: 8]
        showAccountModal: false, //[cite: 8]
        showUserAdminModal: false, //[cite: 8]
        
        newItemForm: { name: '', categoryId: '', supplierName: '', threshold: 0, mrp: '' }, //[cite: 8]
        newCategoryForm: { name: '', emoji: '📦', paletteIndex: 0 }, //[cite: 8]
        paletteOptions: [
            { bg: '#eff6ff', border: '#3b82f6', text: '#1e40af' }, //[cite: 8]
            { bg: '#fffbeb', border: '#f59e0b', text: '#92400e' }, //[cite: 8]
            { bg: '#f0fdf4', border: '#22c55e', text: '#166534' }, //[cite: 8]
            { bg: '#faf5ff', border: '#a855f7', text: '#6b21a8' }, //[cite: 8]
            { bg: '#fdf2f8', border: '#ec4899', text: '#9d174d' }, //[cite: 8]
            { bg: '#f8fafc', border: '#64748b', text: '#334151' } //[cite: 8]
        ],

        accountForm: { currentPassword: '', newPassword: '' }, //[cite: 8]
        accountError: '', //[cite: 8]
        accountSuccess: '', //[cite: 8]
        newUserForm: { username: '', password: '', role: 'inward' }, //[cite: 8]
        newUserError: '', //[cite: 8]
        departments: ['Chinese', 'Indian', 'South Indian', 'Gujarati', 'Continental', 'Tandoor'], //[cite: 8]

        formatStock(stock, itemName = "") {
            return formatStockDisplay(stock, itemName);
        },

        async init() {
            this.restoreSession();

            try {
                await seedIfEmpty(); //[cite: 8]
            } catch (err) {
                console.warn("Seeding error:", err); //[cite: 8]
            }
            
            onSnapshot(colRef('categories'), (snap) => { this.categories = snap.docs.map((d) => ({ id: d.id, ...d.data() })); }); //[cite: 8]
            onSnapshot(colRef('items'), (snap) => { this.items = snap.docs.map((d) => ({ id: d.id, ...d.data() })); }); //[cite: 8]
            onSnapshot(colRef('suppliers'), (snap) => { this.suppliers = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a,b) => a.name.localeCompare(b.name)); }); //[cite: 8]

            onSnapshot(colRef('purchase_orders'), (snap) => { //[cite: 8]
                this.purchaseOrders = snap.docs.map((d) => ({ id: d.id, ...d.data() })) //[cite: 8]
                    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)); //[cite: 8]
            });
            
            let isInitialEventLoad = true;
            onSnapshot(colRef('catering_events'), (snap) => { //[cite: 8]
                const events = snap.docs.map((d) => ({ id: d.id, ...d.data() })); //[cite: 8]
                if (!isInitialEventLoad) {
                    snap.docChanges().forEach((change) => {
                        if (change.type === "added") { //[cite: 8]
                            const data = change.doc.data(); //[cite: 8]
                            sendBrowserNotification(
                                "🎉 High-Pax Catering Event Scheduled!",
                                `Party: ${data.partyName} | Attendance: ${data.paxCount} Pax | Date: ${data.date}`
                            );
                        }
                    });
                }
                this.cateringEvents = events; //[cite: 8]
                isInitialEventLoad = false; //[cite: 8]
            });

            onSnapshot(colRef('logs'), (snap) => { //[cite: 8]
                this.allRawLogs = snap.docs.map((d) => ({ id: d.id, ...d.data() })); //[cite: 8]
                const todayStr = new Date().toISOString().slice(0, 10); //[cite: 8]
                
                this.logs = [...this.allRawLogs] //[cite: 8]
                    .filter((l) => l.created_at && l.created_at.slice(0, 10) === todayStr) //[cite: 8]
                    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)) //[cite: 8]
                    .slice(0, 50) //[cite: 8]
                    .map((l) => { //[cite: 8]
                        const matchedItem = this.items.find((i) => String(i.id) === String(l.item_id)); //[cite: 8]
                        return { ...l, item_name: matchedItem ? matchedItem.name : 'Unknown' }; //[cite: 8]
                    });
            });

            onSnapshot(colRef('users'), (snap) => { //[cite: 8]
                this.users = snap.docs.map((d) => ({ id: d.id, ...d.data() })); //[cite: 8]
                if (this.currentUserId) { //[cite: 8]
                    const me = this.users.find((u) => u.id === this.currentUserId); //[cite: 8]
                    if (!me) this.logout(); //[cite: 8]
                    else { this.currentRole = me.role; this.currentUsername = me.username; } //[cite: 8]
                }
                this.restoreSession(); //[cite: 8]
            });

            this.initDailyStockCheckSchedule(); //[cite: 8]
        },

        initDailyStockCheckSchedule() {
            let lastTrigger = ""; //[cite: 8]
            setInterval(() => { //[cite: 8]
                const now = new Date(); //[cite: 8]
                const hours = now.getHours(); //[cite: 8]
                const minutes = now.getMinutes(); //[cite: 8]
                const todayStr = now.toISOString().slice(0, 10); //[cite: 8]

                if (hours === 11 && minutes === 0 && lastTrigger !== `${todayStr}_1100`) { //[cite: 8]
                    lastTrigger = `${todayStr}_1100`; //[cite: 8]
                    this.notifyLowStockItems("11:00 AM Low Stock Audit Alert"); //[cite: 8]
                }

                if (hours === 22 && minutes === 30 && lastTrigger !== `${todayStr}_2230`) { //[cite: 8]
                    lastTrigger = `${todayStr}_2230`; //[cite: 8]
                    this.notifyLowStockItems("10:30 PM Nightly Stock Alert"); //[cite: 8]
                }
            }, 30000); //[cite: 8]
        },

        async requestNotificationAccess() {
            if (!("Notification" in window)) { //[cite: 8]
                alert("This browser/device does not support Web Notifications."); //[cite: 8]
                return; //[cite: 8]
            }
            const permission = await Notification.requestPermission(); //[cite: 8]
            if (permission === "granted") { //[cite: 8]
                await sendBrowserNotification("Notifications Activated! 🔔", "You will receive real-time catering allocations and low stock alerts."); //[cite: 8]
            } else {
                alert("Permission was denied. Please allow notifications in site settings."); //[cite: 8]
            }
        },

        notifyLowStockItems(triggerTitle = "Low Stock Alert") {
            const lowItems = this.items.filter(i => (Number(i.stock) || 0) <= (Number(i.threshold) || 0)); //[cite: 8]
            if (lowItems.length > 0) { //[cite: 8]
                const itemSummary = lowItems.slice(0, 4).map(i => `${i.name}: ${this.formatStock(i.stock, i.name)}`).join(', ');
                const extra = lowItems.length > 4 ? ` and ${lowItems.length - 4} more` : ''; //[cite: 8]
                sendBrowserNotification(`⚠️ ${triggerTitle}`, `${lowItems.length} items reached safety limit: ${itemSummary}${extra}`); //[cite: 8]
            }
        },

        restoreSession() {
            try {
                const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); //[cite: 8]
                if (session && session.userId) { //[cite: 8]
                    this.currentUserId = session.userId; //[cite: 8]
                    this.isAuthenticated = true; //[cite: 8]
                    if (this.users && this.users.length) { //[cite: 8]
                        const user = this.users.find((u) => u.id === session.userId); //[cite: 8]
                        if (user) { //[cite: 8]
                            this.currentUsername = user.username; //[cite: 8]
                            this.currentRole = user.role; //[cite: 8]
                        }
                    }
                }
            } catch (e) {
                console.warn(e); //[cite: 8]
            }
        },

        async verifyLogin() {
            this.loginError = ''; //[cite: 8]
            const { username, password } = this.loginForm; //[cite: 8]
            if (!username || !password) { this.loginError = 'Fields required'; return; } //[cite: 8]
            const user = this.users.find((u) => u.username.toLowerCase() === username.trim().toLowerCase()); //[cite: 8]
            if (!user || (await sha256(password)) !== user.passwordHash) { this.loginError = 'Invalid credentials'; return; } //[cite: 8]
            this.currentUserId = user.id; this.currentUsername = user.username; this.currentRole = user.role; this.isAuthenticated = true; //[cite: 8]
            this.loginForm.password = ''; //[cite: 8]
            sessionStorage.setItem(SESSION_KEY, JSON.stringify({ userId: user.id })); //[cite: 8]
        },

        logout() { 
            sessionStorage.removeItem(SESSION_KEY); //[cite: 8]
            this.isAuthenticated = false; //[cite: 8]
            this.currentRole = 'readonly'; //[cite: 8]
            this.currentUsername = ''; //[cite: 8]
            this.currentUserId = null; //[cite: 8]
            window.location.reload(); //[cite: 8]
        },

        get processedItems() {
            let dataset = this.items.map((i) => { //[cite: 8]
                const cat = this.categories.find((c) => c.id === i.category_id) || {}; //[cite: 8]
                return { ...i, category_name: cat.name || 'Unassigned', emoji: cat.emoji || '📦', bg: cat.bg_color || '#f3f4f6', border: cat.border_color || '#9ca3af', text_color: cat.text_color || '#374151' }; //[cite: 8]
            });

            if (this.filterCat !== 'all') { //[cite: 8]
                dataset = dataset.filter((i) => i.category_name === this.filterCat); //[cite: 8]
            }

            if (this.filterSupplier !== 'all') { //[cite: 8]
                const defaultSupplier = this.suppliers[0] ? this.suppliers[0].name : ''; //[cite: 8]
                dataset = dataset.filter((i) => (i.supplier_name || defaultSupplier) === this.filterSupplier); //[cite: 8]
            }

            return dataset.sort((a, b) => { //[cite: 8]
                let aAlert = a.stock <= a.threshold ? 1 : 0; let bAlert = b.stock <= b.threshold ? 1 : 0; //[cite: 8]
                if (aAlert !== bAlert) return bAlert - aAlert; //[cite: 8]
                return (a.order_index || 0) - (b.order_index || 0); //[cite: 8]
            });
        },

        get filteredInwardItems() {
            if (!this.formInward.supplierName) return []; //[cite: 8]
            const defaultSupplier = this.suppliers[0] ? this.suppliers[0].name : ''; //[cite: 8]
            return this.items.filter(i => { //[cite: 8]
                const itemSupplier = i.supplier_name || defaultSupplier; //[cite: 8]
                return itemSupplier === this.formInward.supplierName; //[cite: 8]
            });
        },

        get filteredOrderDeskItems() {
            if (!this.orderDesk.supplierId) return []; //[cite: 8]
            const vendor = this.suppliers.find(s => String(s.id) === String(this.orderDesk.supplierId)); //[cite: 8]
            if (!vendor) return []; //[cite: 8]
            const defaultSupplier = this.suppliers[0] ? this.suppliers[0].name : ''; //[cite: 8]
            return this.items.filter(i => { //[cite: 8]
                const itemSupplier = i.supplier_name || defaultSupplier; //[cite: 8]
                return itemSupplier === vendor.name; //[cite: 8]
            });
        },

        get processedPurchaseOrders() {
            const currentStatusTab = String(this.orderViewTab).toLowerCase(); //[cite: 8]
            return this.purchaseOrders.filter(o => { //[cite: 8]
                const orderStatus = String(o.status).toLowerCase(); //[cite: 8]
                if (currentStatusTab === 'pending') { //[cite: 8]
                    return orderStatus === 'pending'; //[cite: 8]
                } else {
                    return orderStatus !== 'pending'; //[cite: 8]
                }
            });
        },

        getEventsForDate(dateStr) {
            if (!dateStr || !this.cateringEvents) return []; //[cite: 8]
            return this.cateringEvents.filter(ev => String(ev.date) === String(dateStr)); //[cite: 8]
        },

        getEventCountForDate(dateStr) {
            return this.getEventsForDate(dateStr).length; //[cite: 8]
        },

        viewCateringTextMenu(eventObj) {
            this.cateringModal.label = `${eventObj.partyName} (${eventObj.paxCount} Pax)`; //[cite: 8]
            this.cateringModal.text = eventObj.menuText; //[cite: 8]
            this.cateringModal.show = true; //[cite: 8]
        },

        clearCateringForm() {
            this.cateringForm.partyName = ''; //[cite: 8]
            this.cateringForm.paxCount = ''; //[cite: 8]
            this.cateringForm.rawTextMenu = ''; //[cite: 8]
            this.editingEventId = null; //[cite: 8]
        },

        editCateringEvent(eventObj) {
            this.cateringForm.partyName = eventObj.partyName; //[cite: 8]
            this.cateringForm.paxCount = eventObj.paxCount; //[cite: 8]
            this.cateringForm.rawTextMenu = eventObj.menuText; //[cite: 8]
            this.editingEventId = eventObj.id; //[cite: 8]
        },

        async deleteCateringEvent(eventId) {
            if (!confirm("Are you sure you want to delete this event?")) return; //[cite: 8]
            try {
                await deleteDoc(doc(dbFs, "catering_events", eventId)); //[cite: 8]
                this.cateringEvents = this.cateringEvents.filter(e => e.id !== eventId); //[cite: 8]
                alert("Event deleted successfully."); //[cite: 8]
            } catch (err) {
                alert("Operation failed: " + err.message); //[cite: 8]
            }
        },

        async submitDirectTextCatering(dateString) {
            if (!this.cateringForm.partyName || !this.cateringForm.rawTextMenu) { //[cite: 8]
                alert("Please fill out the party title and paste menu text."); //[cite: 8]
                return; //[cite: 8]
            }

            const payload = {
                date: dateString, //[cite: 8]
                partyName: this.cateringForm.partyName.trim(), //[cite: 8]
                paxCount: Number(this.cateringForm.paxCount) || 0, //[cite: 8]
                menuText: this.cateringForm.rawTextMenu, //[cite: 8]
                updated_at: Date.now() //[cite: 8]
            };

            try {
                if (this.editingEventId) { //[cite: 8]
                    await setDoc(doc(dbFs, "catering_events", this.editingEventId), payload, { merge: true }); //[cite: 8]
                    const idx = this.cateringEvents.findIndex(e => e.id === this.editingEventId); //[cite: 8]
                    if (idx !== -1) this.cateringEvents[idx] = { id: this.editingEventId, ...payload }; //[cite: 8]
                    this.editingEventId = null; //[cite: 8]
                    alert("Function updated successfully!"); //[cite: 8]
                } else {
                    payload.created_at = Date.now(); //[cite: 8]
                    const docRef = await addDoc(colRef('catering_events'), payload); //[cite: 8]
                    payload.id = docRef.id; //[cite: 8]
                    this.cateringEvents = [...this.cateringEvents, payload]; //[cite: 8]
                    alert("Fresh function logged successfully!"); //[cite: 8]
                }
                this.clearCateringForm(); //[cite: 8]
            } catch (err) {
                alert("Save failure: " + err.message); //[cite: 8]
            }
        },

        addItemToOrder() {
            if (!this.orderDesk.selectedItemId || !this.orderDesk.selectedQty || this.orderDesk.selectedQty <= 0) { //[cite: 8]
                alert("Select product and enter valid quantity."); //[cite: 8]
                return; //[cite: 8]
            }
            const itemObj = this.items.find(i => i.id === this.orderDesk.selectedItemId); //[cite: 8]
            if (!itemObj) return; //[cite: 8]

            this.orderDesk.basket.push({ //[cite: 8]
                id: itemObj.id, //[cite: 8]
                name: itemObj.name, //[cite: 8]
                qty: Number(this.orderDesk.selectedQty) //[cite: 8]
            });
            this.orderDesk.selectedItemId = ''; //[cite: 8]
            this.orderDesk.selectedQty = ''; //[cite: 8]
        },

        removeOrderBasketItem(index) {
            this.orderDesk.basket.splice(index, 1); //[cite: 8]
        },

        sendWhatsAppOrder() {
            if (!this.orderDesk.supplierId || this.orderDesk.basket.length === 0) { //[cite: 8]
                alert("Select supplier and add items to purchase basket."); //[cite: 8]
                return; //[cite: 8]
            }
            const supplierObj = this.suppliers.find(s => s.id === this.orderDesk.supplierId); //[cite: 8]
            const supplierName = supplierObj ? supplierObj.name : "Supplier"; //[cite: 8]
            const tomorrow = new Date(); //[cite: 8]
            tomorrow.setDate(tomorrow.getDate() + 1); //[cite: 8]

            let messageLines = [
                `*PURCHASE ORDER: ${supplierName.toUpperCase()}*`, //[cite: 8]
                `*Date:* ${tomorrow.toLocaleDateString('en-GB')}`, //[cite: 8]
                `--------------------------------` //[cite: 8]
            ];

            this.orderDesk.basket.forEach((item, index) => { //[cite: 8]
                messageLines.push(`${index + 1}. *${item.name} - Qty: ${item.qty}*`); //[cite: 8]
            });

            window.open(`https://wa.me/?text=${encodeURIComponent(messageLines.join('\n'))}`, '_blank'); //[cite: 8]
        },

        async approveIncomingOrder(order) {
            if (order.status !== 'PENDING') return; //[cite: 8]
            if (!confirm(`Confirm stock ingestion from ${order.supplier_name}?`)) return; //[cite: 8]

            try {
                for (let record of order.items) { //[cite: 8]
                    const arrivedQty = parseFloat(record.qty) || 0; //[cite: 8]
                    const targetItem = this.items.find(i => String(i.id) === String(record.id)); //[cite: 8]
                    if (targetItem && arrivedQty > 0) { //[cite: 8]
                        const newStock = Math.round((Number(targetItem.stock || 0) + arrivedQty) * 1000) / 1000; //[cite: 8]
                        await updateDoc(doc(dbFs, 'items', targetItem.id), { stock: newStock }); //[cite: 8]
                        await addDoc(colRef('logs'), { type: 'INWARD', item_id: targetItem.id, qty: arrivedQty, supplier_name: order.supplier_name, department: null, created_at: new Date().toISOString(), created_by_name: this.currentUsername }); //[cite: 8]
                    }
                }
                await updateDoc(doc(dbFs, 'purchase_orders', order.id), { status: 'RECEIVED', items: order.items, resolved_at: new Date().toISOString(), resolved_by: this.currentUsername }); //[cite: 8]
                alert("Order approved and balances synchronized."); //[cite: 8]
            } catch (error) { alert("Error: " + error.message); } //[cite: 8]
        },

        async declineIncomingOrder(order) {
            if (order.status !== 'PENDING') return; //[cite: 8]
            if (!confirm(`Cancel order from ${order.supplier_name}?`)) return; //[cite: 8]
            try {
                await updateDoc(doc(dbFs, 'purchase_orders', order.id), { status: 'DECLINED', resolved_at: new Date().toISOString(), resolved_by: this.currentUsername }); //[cite: 8]
                alert("Order canceled."); //[cite: 8]
            } catch (error) { alert("Error: " + error.message); } //[cite: 8]
        },

        isWithin30Minutes(createdAt) {
            if (!createdAt) return false; //[cite: 8]
            return (new Date() - new Date(createdAt)) < 1800000; //[cite: 8]
        },

        async triggerUndo(log) {
            if (!this.isWithin30Minutes(log.created_at)) return alert("Reversal window (30 min) expired."); //[cite: 8]
            if (!confirm("Revert this entry?")) return; //[cite: 8]
            try {
                const targetItem = this.items.find(i => String(i.id) === String(log.item_id)); //[cite: 8]
                if (!targetItem) return alert("Item no longer exists."); //[cite: 8]
                let currentBal = Number(targetItem.stock || 0); //[cite: 8]
                let logQty = parseFloat(log.qty) || 0; //[cite: 8]
                let corrected = log.type === 'INWARD' ? currentBal - logQty : currentBal + logQty; //[cite: 8]
                corrected = Math.round(corrected * 1000) / 1000; //[cite: 8]
                if (corrected < 0) return alert("Stock cannot drop below zero."); //[cite: 8]
                await updateDoc(doc(dbFs, 'items', targetItem.id), { stock: corrected }); //[cite: 8]
                await deleteDoc(doc(dbFs, 'logs', log.id)); //[cite: 8]
                alert("Transaction rolled back successfully!"); //[cite: 8]
            } catch(e) { alert("Error: " + e.message); } //[cite: 8]
        },

        async addInward() {
            if (!this.formInward.itemId || !this.formInward.qty || !this.formInward.supplierName) return alert('Select missing fields.'); //[cite: 8]
            const target = this.items.find((i) => String(i.id) === String(this.formInward.itemId)); //[cite: 8]
            if (!target) return alert('Selected item not found.'); //[cite: 8]
            
            const qty = parseQuantityInput(this.formInward.qty, target.name); 
            if (isNaN(qty) || qty <= 0) return alert('Enter a valid quantity (e.g. 1, 1.25kg, 1250g, 50kg).');
            
            let vendor = this.formInward.supplierName.trim(); //[cite: 8]
            if (vendor === "_NEW_") { //[cite: 8]
                let newVendorName = prompt("Enter new Supplier Name:"); //[cite: 8]
                if (!newVendorName || !newVendorName.trim()) return alert("Supplier name required."); //[cite: 8]
                vendor = newVendorName.trim(); //[cite: 8]
                const matchEx = this.suppliers.find(s => s.name.toLowerCase() === vendor.toLowerCase()); //[cite: 8]
                if (!matchEx) await addDoc(colRef('suppliers'), { name: vendor, phone: '' }); //[cite: 8]
            }

            let entryTimestamp = new Date().toISOString(); //[cite: 8]
            if (this.currentRole === 'admin' && this.formInward.customDate) { //[cite: 8]
                entryTimestamp = new Date(this.formInward.customDate).toISOString(); //[cite: 8]
            }

            try {
                const newStock = Math.round((Number(target.stock || 0) + qty) * 1000) / 1000; //[cite: 8]
                await updateDoc(doc(dbFs, 'items', target.id), { stock: newStock }); //[cite: 8]
                const docRef = await addDoc(colRef('logs'), { //[cite: 8]
                    type: 'INWARD', //[cite: 8]
                    item_id: target.id, //[cite: 8]
                    qty, 
                    supplier_name: vendor, //[cite: 8]
                    department: null, //[cite: 8]
                    created_at: entryTimestamp, //[cite: 8]
                    created_by_name: this.currentUsername //[cite: 8]
                });
                
                this.lastLogId = docRef.id; //[cite: 8]
                this.lastLogType = 'INWARD'; //[cite: 8]
                this.formInward = { itemId: '', qty: '', supplierName: '', customDate: '' }; //[cite: 8]
                alert(`Inward recorded: +${this.formatStock(qty, target.name)} for "${target.name}".`);
            } catch (error) { 
                alert("Write error: " + error.message); //[cite: 8]
            }
        },

        async deductOutward() {
            if (!this.formOutward.itemId || !this.formOutward.qty) return alert('Select missing fields.'); //[cite: 8]
            const target = this.items.find((i) => String(i.id) === String(this.formOutward.itemId)); //[cite: 8]
            if (!target) return alert('Item not found.'); //[cite: 8]
            
            const qty = parseQuantityInput(this.formOutward.qty, target.name); 
            if (isNaN(qty) || qty <= 0) return alert('Enter a valid quantity (e.g. 1, 0.5kg, 500g, 5).');
            if (Number(target.stock || 0) < qty) return alert(`Insufficient stock. Current balance is ${this.formatStock(target.stock, target.name)}.`);

            let entryTimestamp = new Date().toISOString(); //[cite: 8]
            if (this.currentRole === 'admin' && this.formOutward.customDate) { //[cite: 8]
                entryTimestamp = new Date(this.formOutward.customDate).toISOString(); //[cite: 8]
            }

            try {
                const newStock = Math.round((Number(target.stock) - qty) * 1000) / 1000; //[cite: 8]
                const docRef = await addDoc(colRef('logs'), { //[cite: 8]
                    type: 'OUTWARD', //[cite: 8]
                    item_id: target.id, //[cite: 8]
                    qty, 
                    department: this.formOutward.department, //[cite: 8]
                    created_at: entryTimestamp, //[cite: 8]
                    created_by_name: this.currentUsername //[cite: 8]
                });
                
                await updateDoc(doc(dbFs, 'items', target.id), { stock: newStock }); //[cite: 8]
                this.lastLogId = docRef.id; //[cite: 8]
                this.lastLogType = 'OUTWARD'; //[cite: 8]
                this.formOutward = { itemId: '', department: 'Indian', qty: '', customDate: '' }; //[cite: 8]
                alert(`Outward deduction logged: -${this.formatStock(qty, target.name)} for "${target.name}".`);
            } catch (error) { 
                alert("Error: " + error.message); //[cite: 8]
            }
        },

        // Manual Balance Correction for Old Inaccurate Entries
        async quickAdjustStock(item) {
            if (this.currentRole !== 'admin' && this.currentRole !== 'inward') return;
            const currentFormatted = this.formatStock(item.stock, item.name);
            const promptVal = prompt(`Update Total Net Stock for "${item.name}":\nCurrent Balance: ${currentFormatted}\n(Type exact net balance, e.g. 50kg, 100kg, or 50):`, currentFormatted);
            if (promptVal === null) return;
            
            const parsedStock = parseQuantityInput(promptVal, item.name);
            if (isNaN(parsedStock) || parsedStock < 0) return alert("Enter a valid numerical stock quantity.");

            try {
                await updateDoc(doc(dbFs, 'items', item.id), { stock: parsedStock });
                alert(`Stock for "${item.name}" updated to ${this.formatStock(parsedStock, item.name)}!`);
            } catch (e) {
                alert("Update failed: " + e.message);
            }
        },

        async undoLastTransaction() {
            if (!this.lastLogId) return alert("No recent log found."); //[cite: 8]
            if (!confirm(`Revert your last ${this.lastLogType} entry?`)) return; //[cite: 8]
            try {
                const logsSnap = await getDocs(colRef('logs')); //[cite: 8]
                const targetingLog = logsSnap.docs.find(d => d.id === this.lastLogId); //[cite: 8]
                if (!targetingLog) { this.lastLogId = null; return; } //[cite: 8]
                const logData = targetingLog.data(); //[cite: 8]
                if (!this.isWithin30Minutes(logData.created_at)) return alert("Reversal window expired."); //[cite: 8]
                const targetItem = this.items.find(i => String(i.id) === String(logData.item_id)); //[cite: 8]
                if (!targetItem) return; //[cite: 8]
                let logQty = parseFloat(logData.qty) || 0; //[cite: 8]
                let balanceCorrection = logData.type === 'INWARD' ? Number(targetItem.stock || 0) - logQty : Number(targetItem.stock || 0) + logQty; //[cite: 8]
                balanceCorrection = Math.round(balanceCorrection * 1000) / 1000; //[cite: 8]
                if (balanceCorrection < 0) return alert("Rollback denied."); //[cite: 8]
                await updateDoc(doc(dbFs, 'items', targetItem.id), { stock: balanceCorrection }); //[cite: 8]
                await deleteDoc(doc(dbFs, 'logs', this.lastLogId)); //[cite: 8]
                alert(`Rolled back successfully.`); //[cite: 8]
                this.lastLogId = null; this.lastLogType = ''; //[cite: 8]
            } catch (e) { alert(e.message); } //[cite: 8]
        },

        async changeUserRole(userId, role) { await updateDoc(doc(dbFs, 'users', userId), { role }); }, //[cite: 8]
        async deleteUser(userId) { if (confirm('Delete user?')) await deleteDoc(doc(dbFs, 'users', userId)); }, //[cite: 8]
        
        async changeMyPassword() {
            if (this.currentRole !== 'admin') return alert("Only Administrators can modify profiles."); //[cite: 8]
            this.accountError = ''; this.accountSuccess = ''; //[cite: 8]
            const { currentPassword, newPassword } = this.accountForm; //[cite: 8]
            if (newPassword.length < 6) { this.accountError = 'Min 6 characters'; return; } //[cite: 8]
            const user = this.users.find((u) => u.id === this.currentUserId); //[cite: 8]
            if ((await sha256(currentPassword)) !== user.passwordHash) { this.accountError = 'Incorrect password'; return; } //[cite: 8]
            await updateDoc(doc(dbFs, 'users', user.id), { passwordHash: await sha256(newPassword) }); //[cite: 8]
            this.accountSuccess = 'Password updated.'; //[cite: 8]
            this.accountForm = { currentPassword: '', newPassword: '' }; //[cite: 8]
        },

        async createUser() {
            const { username, password, role = 'inward' } = this.newUserForm; //[cite: 8]
            if (!username || password.length < 6) return alert("Username required and password must be 6+ chars."); //[cite: 8]
            try {
                const passwordHash = await sha256(password); //[cite: 8]
                await addDoc(colRef('users'), { username: username.trim(), passwordHash, role }); //[cite: 8]
                this.newUserForm = { username: '', password: '', role: 'inward' }; //[cite: 8]
                alert("Operator created."); //[cite: 8]
            } catch (e) { alert(e.message); } //[cite: 8]
        },
        
        async promptResetPassword(user) {
            if (this.currentRole !== 'admin') return alert("Denied."); //[cite: 8]
            let newPass = prompt(`Enter new password for ${user.username} (Min 6 chars):`); //[cite: 8]
            if (!newPass || newPass.trim().length < 6) return alert("Minimum 6 characters needed."); //[cite: 8]
            try {
                await updateDoc(doc(dbFs, 'users', user.id), { passwordHash: await sha256(newPass.trim()) }); //[cite: 8]
                alert("Password updated!"); //[cite: 8]
            } catch (error) { alert(error.message); } //[cite: 8]
        },

        async changeItemName(item) {
            let updatedName = prompt(`[1/3] Update Name:`, item.name); //[cite: 8]
            if (!updatedName || !updatedName.trim()) return; //[cite: 8]

            let promptPrice = prompt(`[2/3] Unit Price (MRP):`, item.mrp || 0); //[cite: 8]
            let finalPrice = Number(promptPrice) || 0; //[cite: 8]

            try {
                await updateDoc(doc(dbFs, 'items', item.id), { name: updatedName.trim(), mrp: finalPrice }); //[cite: 8]
                alert("Updated cleanly."); //[cite: 8]
            } catch (e) { alert(e.message); } //[cite: 8]
        },

        async modifyThreshold(item) {
            let promptVal = prompt('Update safety limit:', this.formatStock(item.threshold, item.name)); //[cite: 8]
            if (promptVal !== null) {
                const parsed = parseQuantityInput(promptVal, item.name);
                if (!isNaN(parsed)) await updateDoc(doc(dbFs, 'items', item.id), { threshold: parsed });
            }
        },

        async purgeItem(id) { if (confirm('Purge item entry?')) await deleteDoc(doc(dbFs, 'items', id)); }, //[cite: 8]

        async shiftOrder(id, direction) {
            const sorted = [...this.items].sort((a, b) => (a.order_index || 0) - (b.order_index || 0)); //[cite: 8]
            const idx = sorted.findIndex((i) => i.id === id); if (idx === -1) return; //[cite: 8]
            const swapIdx = idx + (direction === 'up' ? -1 : 1); if (swapIdx < 0 || swapIdx >= sorted.length) return; //[cite: 8]
            await updateDoc(doc(dbFs, 'items', sorted[idx].id), { order_index: sorted[swapIdx].order_index || 0 }); //[cite: 8]
            await updateDoc(doc(dbFs, 'items', sorted[swapIdx].id), { order_index: sorted[swapIdx].order_index || 0 }); //[cite: 8]
        },

        async submitNewItem() {
            if (!this.newItemForm.name.trim() || !this.newItemForm.categoryId || !this.newItemForm.supplierName) return alert("Please map all fields."); //[cite: 8]
            const maxOrder = this.items.reduce((m, i) => Math.max(m, i.order_index || 0), 0); //[cite: 8]
            const parsedThreshold = parseQuantityInput(this.newItemForm.threshold, this.newItemForm.name) || 0;
            await addDoc(colRef('items'), { name: this.newItemForm.name.trim(), category_id: this.newItemForm.categoryId, supplier_name: this.newItemForm.supplierName, stock: 0, threshold: parsedThreshold, mrp: Number(this.newItemForm.mrp || 0), order_index: maxOrder + 1 }); //[cite: 8]
            this.newItemForm = { name: '', categoryId: '', supplierName: '', threshold: 0, mrp: '' }; //[cite: 8]
            this.showNewItemModal = false; //[cite: 8]
        },

        downloadInwardSupplierReport() {
            const inwards = this.allRawLogs.filter(l => l.type === 'INWARD' && l.created_at); //[cite: 8]
            if (!inwards.length) return alert("No inward data available."); //[cite: 8]
            const wb = XLSX.utils.book_new(); //[cite: 8]
            const dateGroups = {}; //[cite: 8]
            inwards.forEach(log => { //[cite: 8]
                const dateKey = log.created_at.slice(0, 10); //[cite: 8]
                if (!dateGroups[dateKey]) dateGroups[dateKey] = []; //[cite: 8]
                dateGroups[dateKey].push(log); //[cite: 8]
            });
            Object.keys(dateGroups).sort().forEach(dateStr => { //[cite: 8]
                const sheetMatrix = [["ITEM NAME", "QUANTITY RECEIVED", "UNIT PRICE", "TOTAL VALUATION"]]; //[cite: 8]
                dateGroups[dateStr].forEach(log => { //[cite: 8]
                    const linkedItem = this.items.find(i => String(i.id) === String(log.item_id)) || {}; //[cite: 8]
                    const qty = parseFloat(log.qty) || 0; //[cite: 8]
                    const price = parseFloat(linkedItem.mrp) || 0; //[cite: 8]
                    sheetMatrix.push([log.item_name || linkedItem.name, this.formatStock(qty, log.item_name || linkedItem.name), `₹${price}`, `₹${qty * price}`]);
                });
                const ws = XLSX.utils.aoa_to_sheet(sheetMatrix); //[cite: 8]
                XLSX.utils.book_append_sheet(wb, ws, dateStr); //[cite: 8]
            });
            XLSX.writeFile(wb, `Inward_Report_${new Date().toISOString().slice(0,10)}.xlsx`); //[cite: 8]
        },

        downloadExcelReport() {
            const getLocalDateString = (offsetDays) => { const d = new Date(); d.setDate(d.getDate() - offsetDays); return d.toISOString().slice(0, 10); }; //[cite: 8]
            const targetDays = Array.from({length: 30}, (_, i) => getLocalDateString(i)); //[cite: 8]
            const headerRow = ["ITEM NAME", "CURRENT STOCK", ...targetDays]; //[cite: 8]
            const matrixData = [headerRow]; //[cite: 8]
            this.processedItems.forEach(item => { //[cite: 8]
                const row = [item.name, this.formatStock(item.stock, item.name)];
                targetDays.forEach(dateStr => { //[cite: 8]
                    const inQty = this.allRawLogs.filter(l => l.created_at?.slice(0, 10) === dateStr && String(l.item_id) === String(item.id) && l.type === 'INWARD').reduce((s, l) => s + (parseFloat(l.qty) || 0), 0); //[cite: 8]
                    const outQty = this.allRawLogs.filter(l => l.created_at?.slice(0, 10) === dateStr && String(l.item_id) === String(item.id) && l.type === 'OUTWARD').reduce((s, l) => s + (parseFloat(l.qty) || 0), 0); //[cite: 8]
                    row.push(`+${this.formatStock(inQty, item.name)} / -${this.formatStock(outQty, item.name)}`);
                });
                matrixData.push(row); //[cite: 8]
            });
            const ws = XLSX.utils.aoa_to_sheet(matrixData); //[cite: 8]
            const wb = XLSX.utils.book_new(); //[cite: 8]
            XLSX.utils.book_append_sheet(wb, ws, "30-Day Ledger"); //[cite: 8]
            XLSX.writeFile(wb, `Stock_Report_${getLocalDateString(0)}.xlsx`); //[cite: 8]
        }
    };
}

// Global Alpine Initialization
window.stockApp = stockApp;
if (window.Alpine) {
    window.Alpine.data('stockApp', stockApp);
} else {
    document.addEventListener('alpine:init', () => {
        window.Alpine.data('stockApp', stockApp);
    });
}
