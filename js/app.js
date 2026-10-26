/* =========================================================
 * SteamPay — клиентская логика платёжной формы (чистый JS)
 * Маски ввода, валидация (алгоритм Луна), превью карты,
 * расчёт заказа и имитация проведения платежа.
 * ========================================================= */
"use strict";

/* ---------- Данные заказа (можно заменить на fetch к API) ---------- */
const WALLET_BALANCE = 1250.0; // ₽ на кошельке Steam
const CART = [
    { name: "Cyberpunk 2077",              price: 1999.0, discount: 0.5 },
    { name: "Counter-Strike 2 — Prime",    price: 1499.0, discount: 0   },
    { name: "DLC: Wings of the Nine",      price: 459.0,  discount: 0.1 },
];

/* ---------- Утилиты ---------- */
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

/** Форматирование суммы в стиле Steam: ₽ 1 999,00 */
function formatMoney(v) {
    return "₽ " + v.toLocaleString("ru-RU", {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
}

/* ---------- Расчёт заказа ---------- */
function calcOrder() {
    let total = 0, discountSum = 0;
    for (const item of CART) {
        const base = item.price;
        const disc = base * (item.discount || 0);
        total += base;
        discountSum += disc;
    }
    const afterDiscount = total - discountSum;
    const useWallet = $("#useWallet").checked;
    const walletPart = useWallet ? Math.min(WALLET_BALANCE, afterDiscount) : 0;
    const toPay = Math.max(0, afterDiscount - walletPart);
    return { total, discountSum, afterDiscount, walletPart, toPay };
}

function renderOrder() {
    const itemsBox = $("#orderItems");
    itemsBox.innerHTML = "";
    for (const item of CART) {
        const el = document.createElement("div");
        el.className = "item";
        const finalPrice = item.price * (1 - (item.discount || 0));
        el.innerHTML = `
            <span>${item.name}${item.discount ? ` <em style="color:#a1cd44">−${Math.round(item.discount * 100)}%</em>` : ""}</span>
            <span class="item__price">${formatMoney(finalPrice)}</span>`;
        itemsBox.appendChild(el);
    }

    const o = calcOrder();
    $("#sumTotal").textContent = formatMoney(o.total);

    const discRow = $("#discountRow");
    discRow.hidden = o.discountSum <= 0;
    $("#sumDiscount").textContent = "−" + formatMoney(o.discountSum);

    const walletRow = $("#walletRow");
    walletRow.hidden = o.walletPart <= 0;
    $("#sumWallet").textContent = "−" + formatMoney(o.walletPart);

    $("#sumToPay").textContent = formatMoney(o.toPay);
    $("#payBtnAmount").textContent = o.toPay > 0 ? "— " + formatMoney(o.toPay) : "(с кошелька)";
    $("#walletBalance").textContent = formatMoney(WALLET_BALANCE);
}

/* ---------- Определение ПС по номеру карты (BIN) ---------- */
function detectBrand(digits) {
    if (/^2[0-4]/.test(digits))           return { name: "МИР", cls: "mir" };   // 2200–2204 и т.д.
    if (/^4/.test(digits))                return { name: "VISA", cls: "visa" };
    if (/^(5[1-5]|2[6-7])/.test(digits))  return { name: "MASTERCARD", cls: "mc" };
    if (/^3[47]/.test(digits))            return { name: "AMEX", cls: "" };
    return { name: "CARD", cls: "" };
}

/* ---------- Алгоритм Луна ---------- */
function luhnCheck(digits) {
    let sum = 0, dbl = false;
    for (let i = digits.length - 1; i >= 0; i--) {
        let d = +digits[i];
        if (dbl) { d *= 2; if (d > 9) d -= 9; }
        sum += d;
        dbl = !dbl;
    }
    return digits.length >= 13 && sum % 10 === 0;
}

/* ---------- Ввод / маски ---------- */
function bindInputMask(id, handler) {
    const el = $(id);
    el.addEventListener("input", () => handler(el));
}

function setupMasks() {
    // Номер карты: только цифры, группы по 4, максимум 19 цифр
    bindInputMask("#cardNumber", (el) => {
        let digits = el.value.replace(/\D/g, "").slice(0, 19);
        el.value = digits.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
        updateCardPreview(digits);
    });

    // Срок действия: ММ/ГГ с автослэшем
    bindInputMask("#expiry", (el) => {
        let v = el.value.replace(/\D/g, "").slice(0, 4);
        // ограничиваем месяц 12
        if (v.length >= 1 && +v[0] > 1 && v[1] === undefined) v = "0" + v;
        if (v.length >= 2 && +v.slice(0, 2) > 12) v = "12" + v.slice(2);
        el.value = v.length > 2 ? v.slice(0, 2) + "/" + v.slice(2) : v;
        updateCardPreview($("#cardNumber").value.replace(/\D/g, ""));
    });

    // CVC: только цифры
    bindInputMask("#cvc", (el) => {
        el.value = el.value.replace(/\D/g, "").slice(0, 4);
    });

    // ФИО: буквы (рус/лат) и дефис
    ["#lastName", "#firstName", "#middleName"].forEach((id) => {
        bindInputMask(id, (el) => {
            el.value = el.value.replace(/[^А-Яа-яЁёA-Za-z\s-]/g, "");
            updateCardHolder();
        });
    });

    // Показ/скрытие CVC
    $("#cvcToggle").addEventListener("click", () => {
        const cvc = $("#cvc");
        cvc.type = cvc.type === "password" ? "text" : "password";
    });
}

/* ---------- Живое превью карты ---------- */
function updateCardPreview(digits) {
    const brand = detectBrand(digits);
    const preview = $("#cardPreview");

    preview.classList.remove("visa", "mc", "mir");
    if (brand.cls) preview.classList.add(brand.cls);
    $("#cardBrand").textContent = brand.name;

    let shown = "";
    for (let i = 0; i < 16; i++) {
        shown += i < digits.length ? digits[i] : "•";
        if (i % 4 === 3 && i !== 15) shown += " ";
    }
    $("#cardNumberPreview").textContent = shown;

    const exp = $("#expiry").value;
    $("#cardExpiryPreview").textContent = exp || "MM/YY";
}

function updateCardHolder() {
    const last  = $("#lastName").value.trim();
    const first = $("#firstName").value.trim();
    const holder = (last + " " + first).trim().toUpperCase();
    $("#cardHolderPreview").textContent = holder || "YOUR NAME";
}

/* ---------- Валидация ---------- */
const validators = {
    lastName(v) {
        if (!v.trim()) return "Укажите фамилию";
        if (v.trim().length < 2) return "Фамилия слишком короткая";
        return "";
    },
    firstName(v) {
        if (!v.trim()) return "Укажите имя";
        if (v.trim().length < 2) return "Имя слишком короткое";
        return "";
    },
    middleName(v) {
        if (v.trim() && v.trim().length < 3) return "Отчество слишком короткое";
        return "";
    },
    email(v) {
        if (!v.trim()) return "Укажите электронную почту";
        if (!/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(v.trim())) return "Некорректный формат e-mail";
        return "";
    },
    cardNumber(v) {
        const d = v.replace(/\D/g, "");
        if (!d) return "Введите номер карты";
        if (d.length < 13 || d.length > 19) return "Номер должен содержать 13–19 цифр";
        if (!luhnCheck(d)) return "Номер карты не прошёл проверку (алгоритм Луна)";
        return "";
    },
    expiry(v) {
        const m = v.match(/^(\d{2})\/(\d{2})$/);
        if (!m) return "Формат срока: ММ/ГГ";
        const month = +m[1], year = 2000 + +m[2];
        if (month < 1 || month > 12) return "Некорректный месяц";
        const now = new Date();
        const endOfMonth = new Date(year, month, 1); // первое число следующего месяца
        if (endOfMonth <= now) return "Срок действия карты истёк";
        if (year > now.getFullYear() + 20) return "Слишком далёкая дата";
        return "";
    },
    cvc(v) {
        if (!v) return "Введите CVC";
        if (!/^\d{3,4}$/.test(v)) return "CVC — 3 или 4 цифры";
        return "";
    },
};

function setError(name, msg) {
    const input = $("#" + name);
    const box = $(`[data-error-for="${name}"]`);
    if (box) {
        box.textContent = msg;
        box.classList.toggle("show", !!msg);
    }
    if (input && input.type !== "checkbox") {
        input.classList.toggle("invalid", !!msg);
    }
}

function validateField(name) {
    const el = $("#" + name);
    if (!el || !validators[name]) return true;
    const msg = validators[name](el.value);
    setError(name, msg);
    return !msg;
}

function setupLiveValidation() {
    Object.keys(validators).forEach((name) => {
        const el = $("#" + name);
        el.addEventListener("blur", () => validateField(name));
        el.addEventListener("input", () => {
            if (el.classList.contains("invalid")) validateField(name);
        });
    });
}

/* ---------- Имитация платёжного шлюза ---------- */
function mockGateway(paymentData) {
    return new Promise((resolve) => {
        // «Банк» отклоняет карты, оканчивающиеся на 0000 — для демонстрации ошибки
        setTimeout(() => {
            const last4 = paymentData.cardNumber.slice(-4);
            if (last4 === "0000") {
                resolve({ ok: false, code: "insufficient_funds", message: "Недостаточно средств на карте" });
            } else {
                resolve({
                    ok: true,
                    transactionId: "STEAM-" + Date.now().toString(36).toUpperCase(),
                    amount: paymentData.amount,
                });
            }
        }, 1800);
    });
}

/* ---------- Модальное окно ---------- */
const modal = $("#modal"), modalBox = modal.querySelector(".modal__box");
function showModal(icon, title, text, showClose) {
    modalBox.classList.remove("success", "error");
    $("#modalIcon").textContent = icon;
    $("#modalTitle").textContent = title;
    $("#modalText").textContent = text;
    $("#modalClose").hidden = !showClose;
    modal.hidden = false;
}
function hideModal() { modal.hidden = true; }

/* ---------- Отправка формы ---------- */
function handleSubmit(e) {
    e.preventDefault();

    // Валидация всех полей
    let firstBad = null;
    for (const name of Object.keys(validators)) {
        if (!validateField(name) && !firstBad) firstBad = $("#" + name);
    }
    const agree = $("#agree");
    setError("agree", agree.checked ? "" : "Необходимо принять условия соглашения");
    if (!agree.checked && !firstBad) firstBad = agree;

    if (firstBad) {
        firstBad.focus();
        return;
    }

    const o = calcOrder();
    const payload = {
        fullName: [$("#lastName").value, $("#firstName").value, $("#middleName").value]
                    .map((s) => s.trim()).filter(Boolean).join(" "),
        email: $("#email").value.trim(),
        cardNumber: $("#cardNumber").value.replace(/\D/g, ""),
        expiry: $("#expiry").value,
        // ВАЖНО: CVC никогда не отправляется/не логируется в реальных системах
        amount: o.toPay,
        walletUsed: o.walletPart,
        method: $('input[name="method"]:checked').value,
    };

    const btn = $("#payBtn");
    btn.disabled = true;
    showModal("⏳", "Обрабатываем платёж…", "Не закрывайте страницу. Соединение с банком-эквайером…", false);

    mockGateway(payload)
        .then((res) => {
            if (res.ok) {
                showModal("✅", "Оплата прошла успешно!",
                    `Заказ № ${res.transactionId} подтверждён. Чек отправлен на ${payload.email}.`, true);
                btn.textContent = "✅ Оплачено";
            } else {
                showModal("❌", "Платёж отклонён",
                    `${res.message} (код: ${res.code}). Попробуйте другую карту.`, true);
                btn.disabled = false;
                restorePayButton();
            }
        });
}

function restorePayButton() {
    const btn = $("#payBtn");
    btn.innerHTML = 'Оплатить <span id="payBtnAmount"></span>';
    renderOrder();
}

/* ---------- Выбор способа оплаты ---------- */
function setupMethods() {
    $$('input[name="method"]').forEach((radio) => {
        radio.addEventListener("change", () => {
            $$(".method").forEach((m) => m.classList.remove("method--active"));
            radio.closest(".method").classList.add("method--active");
        });
    });
}

/* ---------- Инициализация ---------- */
document.addEventListener("DOMContentLoaded", () => {
    renderOrder();
    setupMasks();
    setupLiveValidation();
    setupMethods();

    $("#useWallet").addEventListener("change", renderOrder);
    $("#paymentForm").addEventListener("submit", handleSubmit);
    $("#modalClose").addEventListener("click", () => {
        hideModal();
        // сброс формы после успешной оплаты
        $("#paymentForm").reset();
        restorePayButton();
        $("#payBtn").disabled = false;
        updateCardPreview("");
        updateCardHolder();
        $$(".error.show").forEach((e) => e.classList.remove("show"));
    });
});
