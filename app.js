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

// Tokenized Multi-Keyword Search
function isFuzzyMatch(itemName = "", searchQuery = "") {
    if (!searchQuery || !searchQuery.trim()) return true;
    const tokens = searchQuery
        .toLowerCase()
        .split(/\s+/)
        .filter(t => t.length > 0 && !["of", "and", "the", "in", "with", "a", "an", "for"].includes(t));
    if (tokens.length === 0) return true;
    const target = itemName.toLowerCase();
    return tokens.some(token => target.includes(token));
}

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

// Compact Excel short quantity formatting (e.g. 150g, 1.25kg, 500ml)
function formatShortQty(val, itemName = "") {
    const num = Number(val) || 0;
    const pack = getItemPackDetails(itemName);
    const unit = (pack.unit || "").toLowerCase();
    const isKg = /\b(kg|kgs|kilo|kilograms?)\b/i.test(unit) || /\b(kg|kgs|kilo|kilograms?)\b/i.test(itemName);
    const isLiter = /\b(l|ltr|liter|liters|litre)\b/i.test(unit) || /\b(l|ltr|liter|liters|litre)\b/i.test(itemName);
    const isGram = /\b(g|gm|gms|gram|grams)\b/i.test(unit) && !isKg;

    if (isKg) {
        const isNegative = num < 0;
        const absVal = Math.abs(num);
        let wholeKg = Math.floor(absVal);
        let remGrams = Math.round((absVal - wholeKg) * 1000);
        if (remGrams === 1000) {
            wholeKg += 1;
            remGrams = 0;
        }
        if (wholeKg > 0 && remGrams > 0) return `${isNegative ? '-' : ''}${wholeKg}kg ${remGrams}g`;
        if (wholeKg > 0) return `${isNegative ? '-' : ''}${wholeKg}kg`;
        if (remGrams > 0) return `${isNegative ? '-' : ''}${remGrams}g`;
        return `0kg`;
    }

    if (isGram) {
        if (num >= 1000) {
            let wholeKg = Math.floor(num / 1000);
            let remG = Math.round(num % 1000);
            return remG > 0 ? `${wholeKg}kg ${remG}g` : `${wholeKg}kg`;
        }
        return `${num}g`;
    }

    if (isLiter) {
        const isNegative = num < 0;
        const absVal = Math.abs(num);
        let wholeL = Math.floor(absVal);
        let remMl = Math.round((absVal - wholeL) * 1000);
        if (remMl === 1000) {
            wholeL += 1;
            remMl = 0;
        }
        if (wholeL > 0 && remMl > 0) return `${isNegative ? '-' : ''}${wholeL}L ${remMl}ml`;
        if (wholeL > 0) return `${isNegative ? '-' : ''}${wholeL}L`;
        if (remMl > 0) return `${isNegative ? '-' : ''}${remMl}ml`;
        return `0L`;
    }

    if (pack.unit) {
        const cleanUnit = pack.unit
            .replace(/^(kilograms?|kilo|kgs?)$/i, 'kg')
            .replace(/^(grams?|gms?)$/i, 'g')
            .replace(/^(liters?|litres?|ltrs?)$/i, 'L')
            .replace(/^(milliliters?|millilitres?)$/i, 'ml');
        return `${num}${cleanUnit}`;
    }

    return `${num}`;
}

// Converts date string to Sheet Tab Title (e.g. 2026-08-21 -> '21Aug', 2026-07-06 -> '6Jul')
function formatSheetDate(dateStr) {
    if (!dateStr) return "Report";
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    const day = d.getDate();
    const month = d.toLocaleString('en-US', { month: 'short' });
    return `${day}${month}`;
}

// Converts timestamps/ISO strings to YYYY-MM-DD local calendar key
function extractLocalDateKey(dateVal) {
    if (!dateVal) return null;
    if (typeof dateVal === 'string') {
        const match = dateVal.match(/^(\d{4}-\d{2}-\d{2})/);
        if (match) return match[1];
    }
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return null;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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

export function stockApp() {
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
        
        inwardSearchQuery: '',
        formInward: { itemId: '', qty: '', supplierName: '', customDate: '' },
        
        outwardSearchQuery: '',
        formOutward: { itemId: '', department: 'Indian', qty: '', customDate: '' },

        orderDeskSearchQuery: '',
        orderDesk: {
            supplierId: '',
            selectedItemId: '',
            selectedQty: '',
            basket: []
        },

        cateringForm: { partyName: '', paxCount: '', rawTextMenu: '' },
        cateringModal: { show: false, label: '', text: '' },
        editingEventId: null,
        
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

        get filteredInwardItems() {
            if (!this.formInward.supplierName) return [];
            const defaultSupplier = this.suppliers[0] ? this.suppliers[0].name : '';
            return this.items.filter(i => {
                const itemSupplier = i.supplier_name || defaultSupplier;
                const matchesSupplier = itemSupplier === this.formInward.supplierName;
                const matchesQuery = isFuzzyMatch(i.name, this.inwardSearchQuery);
                return matchesSupplier && matchesQuery;
            });
        },

        get filteredOutwardItems() {
            return this.items.filter(i => isFuzzyMatch(i.name, this.outwardSearchQuery));
        },

        get filteredOrderDeskItems() {
            if (!this.orderDesk.supplierId) return [];
            const vendor = this.suppliers.find(s => String(s.id) === String(this.orderDesk.supplierId));
            if (!vendor) return [];
            const defaultSupplier = this.suppliers[0] ? this.suppliers[0].name : '';
            return this.items.filter(i => {
                const itemSupplier = i.supplier_name || defaultSupplier;
                const matchesSupplier = itemSupplier === vendor.name;
                const matchesQuery = isFuzzyMatch(i.name, this.orderDeskSearchQuery);
                return matchesSupplier && matchesQuery;
            });
        },

        downloadCurrentStockReport() {
            if (!this.processedItems.length) return alert("No inventory items found to export.");

            const headerRow = [
                "Item Name",
                "Category",
                "Primary Supplier",
                "Current Stock",
                "Safety Limit",
                "Unit Price (MRP)",
                "Total Valuation (₹)",
                "Stock Status"
            ];

            const rows = [headerRow];
            let grandTotalValuation = 0;

            this.processedItems.forEach(item => {
                const stockDisplay = formatShortQty(item.stock, item.name);
                const limitDisplay = formatShortQty(item.threshold, item.name);
                const mrp = Number(item.mrp) || 0;
                const totalVal = Math.round((Number(item.stock) || 0) * mrp * 100) / 100;
                grandTotalValuation += totalVal;

                let status = "Healthy";
                if (item.stock === 0) status = "Out of Stock";
                else if (item.stock <= item.threshold) status = "Low Stock";

                rows.push([
                    item.name,
                    item.category_name,
                    item.supplier_name || 'General Vendor',
                    stockDisplay,
                    limitDisplay,
                    `₹${mrp}`,
                    `₹${totalVal}`,
                    status
                ]);
            });

            rows.push([]);
            rows.push(["", "", "", "", "", "GRAND TOTAL:", `₹${grandTotalValuation.toFixed(2)}`, ""]);

            const ws = XLSX.utils.aoa_to_sheet(rows);
            ws['!cols'] = [
                { wch: 28 },
                { wch: 16 },
                { wch: 22 },
                { wch: 16 },
                { wch: 14 },
                { wch: 16 },
                { wch: 20 },
                { wch: 14 }
            ];

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Current Stock");
            const dateStr = new Date().toISOString().slice(0, 10);
            XLSX.writeFile(wb, `Current_Stock_Report_${dateStr}.xlsx`);
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
                const todayStr = extractLocalDateKey(new Date());
                
                this.logs = [...this.allRawLogs]
                    .filter((l) => extractLocalDateKey(l.created_at) === todayStr)
                    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                    .slice(0, 50)
                    .map((l) => {
                        const matchedItem = this.items.find((i) => String(i.id) === String(l.item_id));
                        return { ...l, item_name: matchedItem ? matchedItem.name : (l.item_name || 'Unknown') };
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
                const todayStr = extractLocalDateKey(now);

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
            this.orderDeskSearchQuery = '';
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
                        await addDoc(colRef('logs'), {
                            type: 'INWARD',
                            item_id: targetItem.id,
                            item_name: targetItem.name,
                            unit_price: parseFloat(targetItem.mrp) || 0,
                            qty: arrivedQty,
                            supplier_name: order.supplier_name,
                            department: null,
                            created_at: new Date().toISOString(),
                            created_by_name: this.currentUsername
                        });
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
            if (isNaN(qty) || qty <= 0) return alert('Enter a valid quantity (e.g. 1, 1.25kg, 1250g, 50kg).');
            
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
                    item_name: target.name,
                    unit_price: parseFloat(target.mrp) || 0,
                    qty, 
                    supplier_name: vendor,
                    department: null,
                    created_at: entryTimestamp,
                    created_by_name: this.currentUsername
                });
                
                this.lastLogId = docRef.id;
                this.lastLogType = 'INWARD';
                this.formInward = { itemId: '', qty: '', supplierName: '', customDate: '' };
                this.inwardSearchQuery = '';
                alert(`Inward recorded: +${formatShortQty(qty, target.name)} for "${target.name}".`);
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
                    item_name: target.name,
                    unit_price: parseFloat(target.mrp) || 0,
                    qty, 
                    department: this.formOutward.department,
                    created_at: entryTimestamp,
                    created_by_name: this.currentUsername
                });
                
                await updateDoc(doc(dbFs, 'items', target.id), { stock: newStock });
                this.lastLogId = docRef.id;
                this.lastLogType = 'OUTWARD';
                this.formOutward = { itemId: '', department: 'Indian', qty: '', customDate: '' };
                this.outwardSearchQuery = '';
                alert(`Outward deduction logged: -${formatShortQty(qty, target.name)} for "${target.name}".`);
            } catch (error) { 
                alert("Error: " + error.message);
            }
        },

        async promptAddNewSupplier() {
            const name = prompt("Enter New Supplier/Vendor Name:");
            if (!name || !name.trim()) return;

            const trimmedName = name.trim();
            const exists = this.suppliers.some(s => s.name.toLowerCase() === trimmedName.toLowerCase());
            if (exists) return alert("Supplier already exists.");

            const phone = prompt("Enter Supplier WhatsApp / Phone Number (optional, with country code e.g. 919876543210):") || "";

            try {
                await addDoc(colRef('suppliers'), { name: trimmedName, phone: phone.trim() });
                alert(`Supplier "${trimmedName}" registered successfully!`);
            } catch (e) {
                alert("Failed to add supplier: " + e.message);
            }
        },

        async quickAdjustStock(item) {
            if (this.currentRole !== 'admin' && this.currentRole !== 'inward') return;
            const currentFormatted = formatShortQty(item.stock, item.name);
            const promptVal = prompt(`Update Total Net Stock for "${item.name}":\nCurrent Balance: ${currentFormatted}\n(Type exact net balance, e.g. 50kg, 100kg, or 50):`, currentFormatted);
            if (promptVal === null) return;
            
            const parsedStock = parseQuantityInput(promptVal, item.name);
            if (isNaN(parsedStock) || parsedStock < 0) return alert("Enter a valid numerical stock quantity.");

            try {
                await updateDoc(doc(dbFs, 'items', item.id), { stock: parsedStock });
                alert(`Stock for "${item.name}" updated to ${formatShortQty(parsedStock, item.name)}!`);
            } catch (e) {
                alert("Update failed: " + e.message);
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
                alert(`Updated "${updatedName.trim()}" at ₹${finalPrice} successfully.`);
            } catch (e) { alert("Update failed: " + e.message); }
        },

        async modifyThreshold(item) {
            let promptVal = prompt('Update safety limit:', formatShortQty(item.threshold, item.name));
            if (promptVal !== null) {
                const parsed = parseQuantityInput(promptVal, item.name);
                if (!isNaN(parsed)) await updateDoc(doc(dbFs, 'items', item.id), { threshold: parsed });
            }
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
            const parsedThreshold = parseQuantityInput(this.newItemForm.threshold, this.newItemForm.name) || 0;
            await addDoc(colRef('items'), { name: this.newItemForm.name.trim(), category_id: this.newItemForm.categoryId, supplier_name: this.newItemForm.supplierName, stock: 0, threshold: parsedThreshold, mrp: Number(this.newItemForm.mrp || 0), order_index: maxOrder + 1 });
            this.newItemForm = { name: '', categoryId: '', supplierName: '', threshold: 0, mrp: '' };
            this.showNewItemModal = false;
        },

        // Inward Report: Date as individual sheets (e.g. 21Aug, 22Aug), separated supplier tables, correct item names, prices, short quantities & grand totals
        downloadInwardSupplierReport() {
            const inwards = this.allRawLogs.filter(l => l.type === 'INWARD' && l.created_at);
            if (!inwards.length) return alert("No inward data available.");

            const dateGroups = {};
            inwards.forEach(log => {
                const dateKey = extractLocalDateKey(log.created_at);
                if (!dateKey) return;
                if (!dateGroups[dateKey]) dateGroups[dateKey] = [];
                dateGroups[dateKey].push(log);
            });

            const sortedDates = Object.keys(dateGroups).sort();
            if (!sortedDates.length) return alert("No dated inward records found.");

            const wb = XLSX.utils.book_new();

            sortedDates.forEach(dateKey => {
                const dayLogs = dateGroups[dateKey];
                const sheetName = formatSheetDate(dateKey);

                const supplierGroups = {};
                dayLogs.forEach(log => {
                    const supName = (log.supplier_name || 'General Vendor').trim();
                    if (!supplierGroups[supName]) supplierGroups[supName] = [];
                    supplierGroups[supName].push(log);
                });

                const sheetMatrix = [];

                Object.keys(supplierGroups).sort().forEach((supName, supIdx) => {
                    if (supIdx > 0) sheetMatrix.push([]);

                    sheetMatrix.push([`Supplier: ${supName.toUpperCase()}`, null, null, null]);
                    sheetMatrix.push(["ITEM NAME", "QUANTITY RECEIVED", "UNIT PRICE", "TOTAL VALUATION"]);

                    let supplierTotalValuation = 0;

                    supplierGroups[supName].forEach(log => {
                        const linkedItem = this.items.find(i => String(i.id) === String(log.item_id)) || {};
                        const itemName = linkedItem.name || log.item_name || 'Unknown Item';
                        const qty = parseFloat(log.qty) || 0;
                        const price = (log.unit_price !== undefined && log.unit_price !== null && log.unit_price !== '') 
                            ? parseFloat(log.unit_price) 
                            : (parseFloat(linkedItem.mrp) || 0);
                        const val = Math.round(qty * price * 100) / 100;

                        supplierTotalValuation += val;

                        sheetMatrix.push([
                            itemName,
                            formatShortQty(qty, itemName),
                            `₹${price}`,
                            `₹${val}`
                        ]);
                    });

                    sheetMatrix.push([null, null, "GRAND TOTAL:", `₹${supplierTotalValuation}`]);
                });

                const ws = XLSX.utils.aoa_to_sheet(sheetMatrix);
                ws['!cols'] = [
                    { wch: 32 },
                    { wch: 20 },
                    { wch: 15 },
                    { wch: 20 }
                ];

                XLSX.utils.book_append_sheet(wb, ws, sheetName);
            });

            const now = new Date();
            const monthYear = now.toLocaleString('en-US', { month: 'short', year: 'numeric' }).replace(' ', '_');
            XLSX.writeFile(wb, `Monthly_Inward_Breakdown_Report_${monthYear}.xlsx`);
        },

        // Daily Inward & Outward Report: Date as individual sheets (e.g. 21Aug, 22Aug)
        downloadExcelReport() {
            if (!this.allRawLogs || !this.allRawLogs.length) return alert("No transaction logs available.");

            const dateGroups = {};
            this.allRawLogs.forEach(log => {
                const dateKey = extractLocalDateKey(log.created_at);
                if (!dateKey) return;
                if (!dateGroups[dateKey]) dateGroups[dateKey] = [];
                dateGroups[dateKey].push(log);
            });

            const sortedDates = Object.keys(dateGroups).sort();
            if (!sortedDates.length) return alert("No date-based activity found to export.");

            const wb = XLSX.utils.book_new();

            sortedDates.forEach(dateKey => {
                const logsOnDate = dateGroups[dateKey];
                const sheetName = formatSheetDate(dateKey);

                const inwardLogs = logsOnDate.filter(l => l.type === 'INWARD');
                const outwardLogs = logsOnDate.filter(l => l.type === 'OUTWARD');

                const sheetMatrix = [];

                // 1. Inward Section per Supplier
                sheetMatrix.push([`=== INWARD TRANSACTIONS (${dateKey}) ===`, null, null, null, null]);
                
                const supplierGroups = {};
                inwardLogs.forEach(log => {
                    const sup = (log.supplier_name || 'General Vendor').trim();
                    if (!supplierGroups[sup]) supplierGroups[sup] = [];
                    supplierGroups[sup].push(log);
                });

                const supKeys = Object.keys(supplierGroups).sort();
                if (supKeys.length === 0) {
                    sheetMatrix.push(["No inward entries recorded for this date.", null, null, null, null]);
                } else {
                    supKeys.forEach((supName, idx) => {
                        if (idx > 0) sheetMatrix.push([]);
                        sheetMatrix.push([`Supplier: ${supName.toUpperCase()}`, null, null, null, null]);
                        sheetMatrix.push(["ITEM NAME", "QUANTITY RECEIVED", "UNIT PRICE", "TOTAL VALUATION", "LOGGED BY"]);

                        let subtotal = 0;
                        supplierGroups[supName].forEach(log => {
                            const linkedItem = this.items.find(i => String(i.id) === String(log.item_id)) || {};
                            const itemName = linkedItem.name || log.item_name || 'Unknown Item';
                            const qty = parseFloat(log.qty) || 0;
                            const price = (log.unit_price !== undefined && log.unit_price !== null && log.unit_price !== '') 
                                ? parseFloat(log.unit_price) 
                                : (parseFloat(linkedItem.mrp) || 0);
                            const val = Math.round(qty * price * 100) / 100;
                            subtotal += val;

                            sheetMatrix.push([
                                itemName,
                                formatShortQty(qty, itemName),
                                `₹${price}`,
                                `₹${val}`,
                                log.created_by_name || 'System'
                            ]);
                        });

                        sheetMatrix.push([null, null, "GRAND TOTAL:", `₹${subtotal}`, null]);
                    });
                }

                sheetMatrix.push([]);
                sheetMatrix.push([]);

                // 2. Outward Section per Department
                sheetMatrix.push([`=== OUTWARD TRANSACTIONS (${dateKey}) ===`, null, null, null, null]);
                
                const deptGroups = {};
                outwardLogs.forEach(log => {
                    const dept = (log.department || 'General Kitchen').trim();
                    if (!deptGroups[dept]) deptGroups[dept] = [];
                    deptGroups[dept].push(log);
                });

                const deptKeys = Object.keys(deptGroups).sort();
                if (deptKeys.length === 0) {
                    sheetMatrix.push(["No outward entries recorded for this date.", null, null, null, null]);
                } else {
                    deptKeys.forEach((deptName, idx) => {
                        if (idx > 0) sheetMatrix.push([]);
                        sheetMatrix.push([`Department: ${deptName.toUpperCase()}`, null, null, null, null]);
                        sheetMatrix.push(["ITEM NAME", "QUANTITY ISSUED", "UNIT PRICE", "TOTAL VALUATION", "ISSUED BY"]);

                        let subtotal = 0;
                        deptGroups[deptName].forEach(log => {
                            const linkedItem = this.items.find(i => String(i.id) === String(log.item_id)) || {};
                            const itemName = linkedItem.name || log.item_name || 'Unknown Item';
                            const qty = parseFloat(log.qty) || 0;
                            const price = (log.unit_price !== undefined && log.unit_price !== null && log.unit_price !== '') 
                                ? parseFloat(log.unit_price) 
                                : (parseFloat(linkedItem.mrp) || 0);
                            const val = Math.round(qty * price * 100) / 100;
                            subtotal += val;

                            sheetMatrix.push([
                                itemName,
                                formatShortQty(qty, itemName),
                                `₹${price}`,
                                `₹${val}`,
                                log.created_by_name || 'System'
                            ]);
                        });

                        sheetMatrix.push([null, null, "GRAND TOTAL:", `₹${subtotal}`, null]);
                    });
                }

                const ws = XLSX.utils.aoa_to_sheet(sheetMatrix);
                ws['!cols'] = [
                    { wch: 32 },
                    { wch: 20 },
                    { wch: 15 },
                    { wch: 20 },
                    { wch: 18 }
                ];

                XLSX.utils.book_append_sheet(wb, ws, sheetName);
            });

            const now = new Date();
            const monthYear = now.toLocaleString('en-US', { month: 'short', year: 'numeric' }).replace(' ', '_');
            XLSX.writeFile(wb, `Daily_Stock_Transactions_Report_${monthYear}.xlsx`);
        }
    };
}

window.stockApp = stockApp;
if (window.Alpine) {
    window.Alpine.data('stockApp', stockApp);
} else {
    document.addEventListener('alpine:init', () => {
        window.Alpine.data('stockApp', stockApp);
    });
}
