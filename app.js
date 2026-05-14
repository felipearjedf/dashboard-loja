const months = [
  "Janeiro",
  "Fevereiro",
  "Marco",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro"
];

const defaultIncome = [
  "Dinheiro",
  "Pix",
  "Débito",
  "1x",
  "2x",
  "3x",
  "SITE CARTÃO",
  "shopee/ml",
  "loja",
  "Linha 10"
];

const defaultExpense = [
  "Anuncios",
  "Embalagens",
  "Frete",
  "Impostos",
  "Fornecedores",
  "Comissoes",
  "Ferramentas",
  "Operacional",
  "Tarifas",
  "Outros"
];

const defaultFixed = [
  "Aluguel",
  "Funcionario",
  "Contabilidade",
  "Internet",
  "Energia",
  "Sistema",
  "Telefone",
  "Seguro",
  "Manutencao",
  "Outros"
];

const ledgerTypes = ["income", "expense", "fixed"];
const creditCardFees = {
  "1x": 0.0433,
  "2x": 0.0568,
  "3x": 0.0663
};

const storeKey = "loja-saas-dashboard-v3";
const themeKey = "loja-saas-dashboard-theme";
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
let pendingImport = null;
let cloudReady = false;
let cloudSaveTimer = null;
let supabaseClient = createSupabaseClient();
const cloudRecordId = window.SUPABASE_CONFIG?.recordId || "loja-principal";
const undoStack = [];
let editSnapshot = null;
let selectedRange = null;
let lastSelectedCell = null;
let draggedRowIndex = null;
let isSelectingCells = false;
let showNetIncomeSummary = false;

applySavedTheme();
let state;

const elements = {
  applyImportButton: document.querySelector("#applyImportButton"),
  calendarHint: document.querySelector("#calendarHint"),
  currentYearResult: document.querySelector("#currentYearResult"),
  dataTable: document.querySelector("#dataTable"),
  expenseTotal: document.querySelector("#expenseTotal"),
  exportButton: document.querySelector("#exportButton"),
  fixedTotal: document.querySelector("#fixedTotal"),
  fileInput: document.querySelector("#fileInput"),
  importDialog: document.querySelector("#importDialog"),
  importPreview: document.querySelector("#importPreview"),
  incomeTotal: document.querySelector("#incomeTotal"),
  logoutButton: document.querySelector("#logoutButton"),
  monthTabs: document.querySelector("#monthTabs"),
  nextYearButton: document.querySelector("#nextYearButton"),
  nextYearTopButton: document.querySelector("#nextYearTopButton"),
  previousYearButton: document.querySelector("#previousYearButton"),
  profitTotal: document.querySelector("#profitTotal"),
  saveButton: document.querySelector("#saveButton"),
  saveStatus: document.querySelector("#saveStatus"),
  sheetTitle: document.querySelector("#sheetTitle"),
  sheetType: document.querySelector("#sheetType"),
  themeToggleButton: document.querySelector("#themeToggleButton"),
  undoButton: document.querySelector("#undoButton"),
  yearSelect: document.querySelector("#yearSelect"),
  yearlyTotalsBody: document.querySelector("#yearlyTotalsBody")
};

updateThemeButton();

function applySavedTheme() {
  const savedTheme = localStorage.getItem(themeKey) || "light";
  document.body.classList.toggle("dark-mode", savedTheme === "dark");
}

function toggleTheme() {
  const nextTheme = document.body.classList.toggle("dark-mode") ? "dark" : "light";
  localStorage.setItem(themeKey, nextTheme);
  updateThemeButton();
}

function updateThemeButton() {
  if (!elements?.themeToggleButton) return;
  const isDark = document.body.classList.contains("dark-mode");
  elements.themeToggleButton.textContent = "☾";
  elements.themeToggleButton.setAttribute("title", isDark ? "Light mode" : "Dark mode");
  elements.themeToggleButton.setAttribute("aria-label", isDark ? "Light mode" : "Dark mode");
  elements.themeToggleButton.setAttribute("aria-pressed", String(isDark));
}

function createSupabaseClient() {
  const config = window.SUPABASE_CONFIG || {};
  if (!config.url || !config.anonKey || !window.supabase?.createClient) return null;
  return window.supabase.createClient(config.url, config.anonKey);
}

async function initCloudSync() {
  if (!supabaseClient) {
    elements.saveStatus.textContent = "Modo local ativo. Configure o Supabase para compartilhar online.";
    document.body.classList.remove("auth-checking");
    return;
  }

  elements.saveStatus.textContent = "Conectando ao Supabase...";
  const { data, error } = await supabaseClient
    .from("dashboard_data")
    .select("data")
    .eq("id", cloudRecordId)
    .maybeSingle();

  if (error) {
    console.error(error);
    elements.saveStatus.textContent = "Nao consegui conectar ao Supabase. Salvando localmente por enquanto.";
    return;
  }

  cloudReady = true;
  if (data?.data && Object.keys(data.data).length > 0) {
    state = ensureShape(data.data);
    localStorage.setItem(storeKey, JSON.stringify(state));
    elements.saveStatus.textContent = "Dados online carregados do Supabase.";
    render();
    return;
  }

  await pushCloudState();
  elements.saveStatus.textContent = "Supabase conectado. Dados iniciais enviados para a nuvem.";
}

async function requireSession() {
  if (!supabaseClient) {
    document.body.classList.remove("auth-checking");
    return true;
  }

  const { data, error } = await supabaseClient.auth.getSession();
  if (error || !data.session) {
    window.location.href = "login.html";
    return false;
  }

  document.body.classList.remove("auth-checking");
  return true;
}

async function logout() {
  if (supabaseClient) await supabaseClient.auth.signOut();
  window.location.href = "login.html";
}

function loadState() {
  const saved = localStorage.getItem(storeKey);
  if (saved) {
    try {
      return ensureShape(JSON.parse(saved));
    } catch {
      localStorage.removeItem(storeKey);
    }
  }

  if (window.IMPORTED_DASHBOARD_STATE) {
    return ensureShape(structuredClone(window.IMPORTED_DASHBOARD_STATE));
  }

  return ensureShape({
    years: [2024],
    currentYear: 2024,
    currentMonth: 0,
    currentLedger: "income",
    ledgers: {}
  });
}

function ensureShape(input) {
  const next = {
    years: Array.isArray(input.years) ? input.years.filter((year) => year >= 2024) : [2024],
    currentYear: Number(input.currentYear) || 2024,
    currentMonth: Number(input.currentMonth) || 0,
    currentLedger: ledgerTypes.includes(input.currentLedger) ? input.currentLedger : "income",
    ledgers: input.ledgers && typeof input.ledgers === "object" ? input.ledgers : {},
    marketplaceTemplateApplied: Boolean(input.marketplaceTemplateApplied)
  };

  if (!next.years.includes(2024)) next.years.push(2024);
  if (!next.years.includes(next.currentYear)) next.years.push(next.currentYear);
  next.years = [...new Set(next.years)].sort((a, b) => a - b);

  next.years.forEach((year) => {
    ledgerTypes.forEach((ledger) => {
      for (let month = 0; month < 12; month += 1) {
        getSheet(next, ledger, year, month);
      }
    });
  });

  if (!next.marketplaceTemplateApplied) {
    replicateMarketplaceCategories(next);
    next.marketplaceTemplateApplied = true;
  }

  return next;
}

function getSheet(source, ledger, year, month) {
  const key = sheetKey(ledger, year, month);
  if (!source.ledgers[key]) {
    const defaults = getDefaultCategories(source, ledger);
    source.ledgers[key] = {
      categories: defaults.slice(),
      values: Array.from({ length: 10 }, () => ({})),
      notes: Array.from({ length: 10 }, () => ({}))
    };
  }

  const sheet = source.ledgers[key];
  while (sheet.categories.length < sheet.values.length) sheet.categories.push(`Linha ${sheet.categories.length + 1}`);
  while (sheet.values.length < sheet.categories.length) sheet.values.push({});
  if (!Array.isArray(sheet.notes)) sheet.notes = [];
  while (sheet.notes.length < sheet.categories.length) sheet.notes.push({});
  return sheet;
}

function getDefaultCategories(source, ledger) {
  if (ledger === "income") return getMarketplaceTemplate(source);
  if (ledger === "fixed") return defaultFixed;
  return defaultExpense;
}

function getMarketplaceTemplate(source) {
  const jan2026 = source.ledgers?.[sheetKey("income", 2026, 0)]?.categories;
  const importedJan2026 = window.IMPORTED_DASHBOARD_STATE?.ledgers?.[sheetKey("income", 2026, 0)]?.categories;
  const template = jan2026 || importedJan2026 || defaultIncome;
  return template.slice();
}

function replicateMarketplaceCategories(source) {
  const template = getMarketplaceTemplate(source);
  source.years.forEach((year) => {
    for (let month = 0; month < 12; month += 1) {
      const sheet = getSheet(source, "income", year, month);
      sheet.categories = template.slice();
    }
  });
}

function sheetKey(ledger, year, month) {
  return `${ledger}-${year}-${month}`;
}

function getLedgerLabel(ledger) {
  if (ledger === "income") return "Vendas";
  if (ledger === "fixed") return "Custos";
  return "Compras";
}

function isDescriptiveLedger(ledger) {
  return ledger === "expense" || ledger === "fixed";
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function saveState() {
  localStorage.setItem(storeKey, JSON.stringify(state));
  queueCloudSave();
  if (elements.saveStatus) {
    elements.saveStatus.textContent = `Salvo automaticamente as ${new Date().toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    })}`;
  }
}

function queueCloudSave() {
  if (!cloudReady || !supabaseClient) return;
  window.clearTimeout(cloudSaveTimer);
  cloudSaveTimer = window.setTimeout(() => {
    pushCloudState();
  }, 650);
}

async function pushCloudState() {
  if (!supabaseClient) return false;
  const { error } = await supabaseClient.from("dashboard_data").upsert({
    id: cloudRecordId,
    data: state,
    updated_at: new Date().toISOString()
  });

  if (error) {
    console.error(error);
    elements.saveStatus.textContent = "Falha ao salvar online. Uma copia local foi mantida.";
    return false;
  }

  return true;
}

function cloneState() {
  return JSON.parse(JSON.stringify(state));
}

function pushUndoSnapshot() {
  undoStack.push(cloneState());
  if (undoStack.length > 50) undoStack.shift();
  updateUndoButton();
}

function updateUndoButton() {
  if (elements.undoButton) elements.undoButton.disabled = undoStack.length === 0;
}

function undoLastChange() {
  const previous = undoStack.pop();
  if (!previous) return;
  state = ensureShape(previous);
  localStorage.setItem(storeKey, JSON.stringify(state));
  queueCloudSave();
  render();
  elements.saveStatus.textContent = "Alteracao desfeita.";
}

function beginEdit() {
  if (!editSnapshot) editSnapshot = cloneState();
}

function finishEdit() {
  if (!editSnapshot) return;
  if (JSON.stringify(editSnapshot) !== JSON.stringify(state)) {
    undoStack.push(editSnapshot);
    if (undoStack.length > 50) undoStack.shift();
    updateUndoButton();
  }
  editSnapshot = null;
}

function parseValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (!value) return 0;

  const formula = normalizeFormulaValue(value);
  if (formula) {
    try {
      const result = Function(`"use strict"; return (${formula});`)();
      return Number.isFinite(result) ? result : 0;
    } catch {
      return 0;
    }
  }

  const normalized = String(value)
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeFormulaValue(value) {
  const text = String(value || "").trim().replace(/=$/, "").trim();
  if (!/[+\-*/()]/.test(text)) return "";
  if (!/^[\d\s,.\-+*/()]+$/.test(text)) return "";

  return text.replace(/\d[\d.,]*/g, (number) =>
    number
      .replace(/\.(?=\d{3}(?:\D|$))/g, "")
      .replace(",", ".")
  );
}

function isFormulaValue(value) {
  return Boolean(normalizeFormulaValue(value));
}

function formatInput(value) {
  return value ? String(value).replace(".", ",") : "";
}

function getCellDisplayValue(sheet, ledger, rowIndex, day) {
  if (isDescriptiveLedger(ledger) && sheet.notes?.[rowIndex]?.[day]) {
    return sheet.notes[rowIndex][day];
  }
  return formatInput(sheet.values[rowIndex][day]);
}

function getNetValue(ledger, category, value) {
  const amount = Number(value || 0);
  if (ledger !== "income") return amount;
  const fee = creditCardFees[normalizeText(category)];
  return fee ? amount * (1 - fee) : amount;
}

function getMonthTotal(ledger, year, month) {
  const sheet = getSheet(state, ledger, year, month);
  const days = daysInMonth(year, month);
  return sheet.values.reduce((total, row, rowIndex) => {
    for (let day = 1; day <= days; day += 1) {
      total += getNetValue(ledger, sheet.categories[rowIndex], row[day]);
    }
    return total;
  }, 0);
}

function getMonthGrossTotal(ledger, year, month) {
  const sheet = getSheet(state, ledger, year, month);
  const days = daysInMonth(year, month);
  return sheet.values.reduce((total, row) => {
    for (let day = 1; day <= days; day += 1) {
      total += Number(row[day] || 0);
    }
    return total;
  }, 0);
}

function render() {
  renderYearSelect();
  renderLedgerTabs();
  renderMonthTabs();
  renderTable();
  renderSummary();
  renderYearlyTotals();
  updateUndoButton();
}

function renderYearSelect() {
  elements.yearSelect.innerHTML = state.years
    .map((year) => `<option value="${year}" ${year === state.currentYear ? "selected" : ""}>${year}</option>`)
    .join("");
  elements.previousYearButton.disabled = state.currentYear <= 2024;
}

function renderLedgerTabs() {
  document.querySelectorAll(".segment").forEach((button) => {
    button.classList.toggle("active", button.dataset.ledger === state.currentLedger);
  });
}

function renderMonthTabs() {
  elements.monthTabs.innerHTML = months
    .map(
      (month, index) =>
        `<button class="month-tab ${index === state.currentMonth ? "active" : ""}" type="button" data-month="${index}">${month}</button>`
    )
    .join("");
}

function renderTable() {
  const year = state.currentYear;
  const month = state.currentMonth;
  const ledger = state.currentLedger;
  const days = daysInMonth(year, month);
  const sheet = getSheet(state, ledger, year, month);
  const label = getLedgerLabel(ledger);

  elements.sheetType.textContent = label;
  elements.sheetTitle.textContent = `${months[month]} de ${year}`;
  elements.calendarHint.textContent = `${days} dias no mes`;

  const headerDays = Array.from({ length: days }, (_, index) => `<th>${index + 1}</th>`).join("");
  const bodyRows = sheet.categories
    .map((category, rowIndex) => {
      const row = sheet.values[rowIndex];
      const rowTotal = Array.from({ length: days }, (_, index) => getNetValue(ledger, category, row[index + 1])).reduce((a, b) => a + b, 0);
      const cells = Array.from({ length: days }, (_, index) => {
        const day = index + 1;
        return `<td><input class="cell-input" inputmode="decimal" aria-label="${category} dia ${day}" data-row="${rowIndex}" data-day="${day}" value="${escapeHtml(getCellDisplayValue(sheet, ledger, rowIndex, day))}" /></td>`;
      }).join("");

      return `
        <tr draggable="true" data-row-index="${rowIndex}">
          <td>
            <div class="category-cell">
              <button class="drag-row-button" type="button" draggable="true" data-drag-row="${rowIndex}" aria-label="Arrastar linha ${rowIndex + 1}" title="Arrastar linha"></button>
              <input class="category-input" aria-label="Nome da linha ${rowIndex + 1}" data-category-row="${rowIndex}" value="${escapeHtml(category)}" />
              <button class="delete-row-button" type="button" data-delete-row="${rowIndex}" aria-label="Excluir linha ${rowIndex + 1}">x</button>
            </div>
          </td>
          ${cells}
          <td class="row-total" data-row-total="${rowIndex}">${currency.format(rowTotal)}</td>
        </tr>
      `;
    })
    .join("");

  const totals = Array.from({ length: days }, (_, index) => {
    const day = index + 1;
    const total = sheet.values.reduce((sum, row, rowIndex) => sum + getNetValue(ledger, sheet.categories[rowIndex], row[day]), 0);
    return `<td class="grand-total" data-day-total="${day}">${currency.format(total)}</td>`;
  }).join("");

  const grandTotal = sheet.values.reduce((sum, row, rowIndex) => {
    for (let day = 1; day <= days; day += 1) sum += getNetValue(ledger, sheet.categories[rowIndex], row[day]);
    return sum;
  }, 0);

  elements.dataTable.innerHTML = `
    <thead>
      <tr>
        <th>${label}</th>
        ${headerDays}
        <th>Total</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
      <tr class="add-row">
        <td>
          <button class="add-row-plus" type="button" data-add-row-end aria-label="Adicionar nova linha">+</button>
        </td>
        ${Array.from({ length: days }, () => "<td></td>").join("")}
        <td></td>
      </tr>
      <tr class="total-row">
        <th>Total diario</th>
        ${totals}
        <td class="grand-total" data-month-total>${currency.format(grandTotal)}</td>
      </tr>
    </tbody>
  `;
}

function renderSummary() {
  const grossIncome = getMonthGrossTotal("income", state.currentYear, state.currentMonth);
  const netIncome = getMonthTotal("income", state.currentYear, state.currentMonth);
  const expense = getMonthTotal("expense", state.currentYear, state.currentMonth);
  const fixed = getMonthTotal("fixed", state.currentYear, state.currentMonth);
  const displayedIncome = showNetIncomeSummary ? netIncome : grossIncome;
  elements.incomeTotal.textContent = currency.format(displayedIncome);
  elements.incomeTotal.parentElement.classList.toggle("summary-clickable", true);
  elements.incomeTotal.parentElement.setAttribute(
    "title",
    showNetIncomeSummary ? "Receita liquida. Clique para ver receita cheia." : "Receita cheia. Clique para ver receita liquida."
  );
  elements.incomeTotal.parentElement.setAttribute(
    "aria-label",
    showNetIncomeSummary ? "Receita liquida do mes" : "Receita cheia do mes"
  );
  elements.expenseTotal.textContent = currency.format(expense);
  elements.fixedTotal.textContent = currency.format(fixed);
  elements.profitTotal.textContent = currency.format(netIncome - expense - fixed);
  elements.profitTotal.style.color = netIncome - expense - fixed < 0 ? "var(--danger)" : "var(--brand)";
}

function toggleIncomeSummaryMode() {
  showNetIncomeSummary = !showNetIncomeSummary;
  renderSummary();
}

function getYearTotal(ledger, year) {
  let total = 0;
  for (let month = 0; month < 12; month += 1) {
    total += getMonthTotal(ledger, year, month);
  }
  return total;
}

function renderYearlyTotals() {
  const rows = state.years
    .map((year) => {
      const income = getYearTotal("income", year);
      const expense = getYearTotal("expense", year);
      const fixed = getYearTotal("fixed", year);
      const result = income - expense - fixed;
      return `
        <tr class="${year === state.currentYear ? "active-year" : ""}">
          <td>${year}</td>
          <td>${currency.format(income)}</td>
          <td>${currency.format(expense)}</td>
          <td>${currency.format(fixed)}</td>
          <td class="${result < 0 ? "negative" : "positive"}">${currency.format(result)}</td>
        </tr>
      `;
    })
    .join("");

  const currentResult =
    getYearTotal("income", state.currentYear) -
    getYearTotal("expense", state.currentYear) -
    getYearTotal("fixed", state.currentYear);
  elements.yearlyTotalsBody.innerHTML = rows;
  elements.currentYearResult.textContent = `${state.currentYear}: ${currency.format(currentResult)}`;
  elements.currentYearResult.style.color = currentResult < 0 ? "var(--danger)" : "var(--brand)";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function goToYear(year) {
  if (year < 2024) return;
  if (!state.years.includes(year)) state.years.push(year);
  state.currentYear = year;
  ensureShape(state);
  saveState();
  render();
}

function goToNextYear() {
  goToYear(state.currentYear + 1);
}

function goToPreviousYear() {
  goToYear(state.currentYear - 1);
}

function updateCell(input) {
  const sheet = getSheet(state, state.currentLedger, state.currentYear, state.currentMonth);
  const row = Number(input.dataset.row);
  const day = Number(input.dataset.day);
  const rawValue = input.value;
  const value = parseValue(rawValue);
  sheet.values[row][day] = value;
  if (isDescriptiveLedger(state.currentLedger)) {
    sheet.notes[row][day] = isFormulaValue(rawValue) ? formatInput(value) : rawValue.trim();
  }
  saveState();
  renderTable();
  renderSummary();
  renderYearlyTotals();
}

function saveCellDraft(input) {
  const sheet = getSheet(state, state.currentLedger, state.currentYear, state.currentMonth);
  const row = Number(input.dataset.row);
  const day = Number(input.dataset.day);
  sheet.values[row][day] = parseValue(input.value);
  if (isDescriptiveLedger(state.currentLedger)) sheet.notes[row][day] = input.value.trim();
  saveState();
  refreshDisplayedTotals();
  renderSummary();
  renderYearlyTotals();
}

function refreshDisplayedTotals() {
  const sheet = getSheet(state, state.currentLedger, state.currentYear, state.currentMonth);
  const days = daysInMonth(state.currentYear, state.currentMonth);
  let monthTotal = 0;

  sheet.values.forEach((row, rowIndex) => {
    let rowTotal = 0;
    for (let day = 1; day <= days; day += 1) rowTotal += getNetValue(state.currentLedger, sheet.categories[rowIndex], row[day]);
    monthTotal += rowTotal;
    const rowTotalCell = elements.dataTable.querySelector(`[data-row-total="${rowIndex}"]`);
    if (rowTotalCell) rowTotalCell.textContent = currency.format(rowTotal);
  });

  for (let day = 1; day <= days; day += 1) {
    const dayTotal = sheet.values.reduce((sum, row, rowIndex) => sum + getNetValue(state.currentLedger, sheet.categories[rowIndex], row[day]), 0);
    const dayTotalCell = elements.dataTable.querySelector(`[data-day-total="${day}"]`);
    if (dayTotalCell) dayTotalCell.textContent = currency.format(dayTotal);
  }

  const monthTotalCell = elements.dataTable.querySelector("[data-month-total]");
  if (monthTotalCell) monthTotalCell.textContent = currency.format(monthTotal);
}

function updateCategory(input) {
  setCategoryName(Number(input.dataset.categoryRow), input.value);
  saveState();
  render();
}

function saveCategoryDraft(input) {
  setCategoryName(Number(input.dataset.categoryRow), input.value);
  saveState();
}

function setCategoryName(rowIndex, value) {
  const fallback = `Linha ${rowIndex + 1}`;
  const name = value.trim() || fallback;

  if (state.currentLedger === "income" || state.currentLedger === "fixed") {
    state.years.forEach((year) => {
      for (let month = 0; month < 12; month += 1) {
        getSheet(state, state.currentLedger, year, month).categories[rowIndex] = name;
      }
    });
    return;
  }

  getSheet(state, state.currentLedger, state.currentYear, state.currentMonth).categories[rowIndex] = name;
}

function addRowAtEnd() {
  pushUndoSnapshot();
  if (state.currentLedger === "income" || state.currentLedger === "fixed") {
    state.years.forEach((year) => {
      for (let month = 0; month < 12; month += 1) {
        const sheet = getSheet(state, state.currentLedger, year, month);
        const prefix = state.currentLedger === "income" ? "Novo marketplace" : "Novo custo fixo";
        sheet.categories.push(`${prefix} ${sheet.categories.length + 1}`);
        sheet.values.push({});
        sheet.notes.push({});
      }
    });
  } else {
    const sheet = getSheet(state, "expense", state.currentYear, state.currentMonth);
    sheet.categories.push(`Novo gasto ${sheet.categories.length + 1}`);
    sheet.values.push({});
    sheet.notes.push({});
  }

  saveState();
  render();
}

function deleteRow(rowIndex) {
  const sheet = getSheet(state, state.currentLedger, state.currentYear, state.currentMonth);
  const rowName = sheet.categories[rowIndex] || `linha ${rowIndex + 1}`;
  const confirmed = window.confirm(`Tem certeza que deseja excluir "${rowName}"? Os valores dessa linha serao apagados e sao irrecuperaveis.`);
  if (!confirmed) return;
  pushUndoSnapshot();

  if (state.currentLedger === "income" || state.currentLedger === "fixed") {
    state.years.forEach((year) => {
      for (let month = 0; month < 12; month += 1) {
        const targetSheet = getSheet(state, state.currentLedger, year, month);
        targetSheet.categories.splice(rowIndex, 1);
        targetSheet.values.splice(rowIndex, 1);
        targetSheet.notes.splice(rowIndex, 1);
      }
    });
  } else {
    sheet.categories.splice(rowIndex, 1);
    sheet.values.splice(rowIndex, 1);
    sheet.notes.splice(rowIndex, 1);
  }

  saveState();
  render();
}

function moveRow(rowIndex, targetIndex) {
  const sheet = getSheet(state, state.currentLedger, state.currentYear, state.currentMonth);
  if (targetIndex < 0 || targetIndex >= sheet.categories.length) return;
  if (rowIndex === targetIndex) return;
  pushUndoSnapshot();

  if (state.currentLedger === "income" || state.currentLedger === "fixed") {
    state.years.forEach((year) => {
      for (let month = 0; month < 12; month += 1) {
        moveRowInSheet(getSheet(state, state.currentLedger, year, month), rowIndex, targetIndex);
      }
    });
  } else {
    moveRowInSheet(sheet, rowIndex, targetIndex);
  }

  saveState();
  render();
}

function moveRowInSheet(sheet, from, to) {
  ["categories", "values", "notes"].forEach((key) => {
    const list = sheet[key];
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
  });
}

function getRowFromDragEvent(event) {
  return event.target.closest("tr[data-row-index]");
}

function clearDragRows() {
  elements.dataTable.querySelectorAll("tr.dragging-row, tr.drag-over-row").forEach((row) => {
    row.classList.remove("dragging-row", "drag-over-row");
  });
}

function clearDragOverRows() {
  elements.dataTable.querySelectorAll("tr.drag-over-row").forEach((row) => {
    row.classList.remove("drag-over-row");
  });
}

function handleRowDragStart(event) {
  const handle = event.target.closest("[data-drag-row]");
  if (!handle) {
    event.preventDefault();
    return;
  }

  draggedRowIndex = Number(handle.dataset.dragRow);
  const row = getRowFromDragEvent(event);
  row?.classList.add("dragging-row");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", String(draggedRowIndex));
}

function handleRowDragOver(event) {
  if (draggedRowIndex === null) return;
  const row = getRowFromDragEvent(event);
  if (!row) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  clearDragOverRows();
  row.classList.add("drag-over-row");
}

function handleRowDrop(event) {
  if (draggedRowIndex === null) return;
  const row = getRowFromDragEvent(event);
  if (!row) return;
  event.preventDefault();
  const targetIndex = Number(row.dataset.rowIndex);
  moveRow(draggedRowIndex, targetIndex);
  draggedRowIndex = null;
  clearDragRows();
}

function handleRowDragEnd() {
  draggedRowIndex = null;
  clearDragRows();
}

function selectCell(input, extend = false) {
  const row = Number(input.dataset.row);
  const day = Number(input.dataset.day);
  if (extend && lastSelectedCell) {
    selectedRange = {
      startRow: Math.min(lastSelectedCell.row, row),
      endRow: Math.max(lastSelectedCell.row, row),
      startDay: Math.min(lastSelectedCell.day, day),
      endDay: Math.max(lastSelectedCell.day, day)
    };
  } else {
    selectedRange = { startRow: row, endRow: row, startDay: day, endDay: day };
    lastSelectedCell = { row, day };
  }
  paintSelection();
}

function startCellSelection(input, event) {
  if (event.button !== 0) return;
  isSelectingCells = true;
  selectCell(input, event.shiftKey);
  input.focus({ preventScroll: true });
}

function extendCellSelection(input) {
  if (!isSelectingCells) return;
  selectCell(input, true);
}

function stopCellSelection() {
  isSelectingCells = false;
}

function paintSelection() {
  elements.dataTable.querySelectorAll(".cell-input").forEach((input) => {
    const row = Number(input.dataset.row);
    const day = Number(input.dataset.day);
    const selected =
      selectedRange &&
      row >= selectedRange.startRow &&
      row <= selectedRange.endRow &&
      day >= selectedRange.startDay &&
      day <= selectedRange.endDay;
    input.classList.toggle("cell-selected", selected);
  });
}

function getSelectedText() {
  if (!selectedRange) return "";
  const sheet = getSheet(state, state.currentLedger, state.currentYear, state.currentMonth);
  const rows = [];
  for (let row = selectedRange.startRow; row <= selectedRange.endRow; row += 1) {
    const cells = [];
    for (let day = selectedRange.startDay; day <= selectedRange.endDay; day += 1) {
      cells.push(getCellDisplayValue(sheet, state.currentLedger, row, day));
    }
    rows.push(cells.join("\t"));
  }
  return rows.join("\n");
}

async function copySelectedCells(event) {
  if (!selectedRange) return;
  const text = getSelectedText();
  if (!text) return;
  event.preventDefault();
  if (event.clipboardData) event.clipboardData.setData("text/plain", text);
  if (navigator.clipboard) await navigator.clipboard.writeText(text).catch(() => {});
}

function pasteCells(event) {
  const active = document.activeElement;
  if (!active?.matches?.(".cell-input")) return;
  const text = event.clipboardData?.getData("text/plain");
  if (!text || !text.includes("\t") && !text.includes("\n")) return;
  event.preventDefault();
  pasteTextAtSelection(text);
}

async function handleGridShortcuts(event) {
  if (event.key === "Enter" && event.target.matches(".cell-input")) {
    event.preventDefault();
    updateCell(event.target);
    event.target.blur();
    return;
  }

  const isMod = event.ctrlKey || event.metaKey;
  if (!isMod) return;

  const key = event.key.toLowerCase();
  if (key === "z") {
    event.preventDefault();
    undoLastChange();
    return;
  }

  if (key === "c" && selectedRange) {
    const text = getSelectedText();
    if (!text) return;
    event.preventDefault();
    await navigator.clipboard?.writeText(text).catch(() => {});
    elements.saveStatus.textContent = "Celulas copiadas.";
    return;
  }

  if (key === "v" && document.activeElement?.matches?.(".cell-input")) {
    const text = await navigator.clipboard?.readText().catch(() => "");
    if (!text || (!text.includes("\t") && !text.includes("\n"))) return;
    pasteTextAtSelection(text);
    event.preventDefault();
  }
}

function pasteTextAtSelection(text) {
  const active = document.activeElement;
  if (!active?.matches?.(".cell-input")) return;
  editSnapshot = null;
  pushUndoSnapshot();

  const startRow = selectedRange?.startRow ?? Number(active.dataset.row);
  const startDay = selectedRange?.startDay ?? Number(active.dataset.day);
  const sheet = getSheet(state, state.currentLedger, state.currentYear, state.currentMonth);
  const days = daysInMonth(state.currentYear, state.currentMonth);
  const rows = text.replace(/\r/g, "").split("\n").filter((row) => row.length > 0).map((row) => row.split("\t"));

  rows.forEach((cells, rowOffset) => {
    const targetRow = startRow + rowOffset;
    if (targetRow >= sheet.categories.length) return;
    cells.forEach((cell, dayOffset) => {
      const targetDay = startDay + dayOffset;
      if (targetDay > days) return;
      sheet.values[targetRow][targetDay] = parseValue(cell);
      if (isDescriptiveLedger(state.currentLedger)) sheet.notes[targetRow][targetDay] = cell.trim();
    });
  });

  saveState();
  render();
}

async function manualSave() {
  saveState();
  const savedOnline = !supabaseClient || (await pushCloudState());
  elements.saveStatus.textContent = `${savedOnline ? "Salvo com seguranca" : "Salvo apenas localmente"} as ${new Date().toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  })}`;
  elements.saveButton.classList.add("saved");
  window.setTimeout(() => elements.saveButton.classList.remove("saved"), 900);
}

function openImport() {
  pendingImport = null;
  elements.fileInput.value = "";
  elements.applyImportButton.disabled = true;
  elements.importPreview.textContent = "Nenhum arquivo selecionado.";
  elements.importDialog.showModal();
}

async function readImport(file) {
  if (!file) return;
  const extension = file.name.split(".").pop().toLowerCase();
  let rows = [];

  if (extension === "csv") {
    rows = parseCsv(await file.text());
  } else if (window.XLSX) {
    const buffer = await file.arrayBuffer();
    const workbook = window.XLSX.read(buffer, { type: "array" });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = window.XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: "" });
  } else {
    elements.importPreview.textContent = "Leitor XLSX ainda nao carregou. Tente novamente em alguns segundos ou use CSV.";
    return;
  }

  pendingImport = mapRowsToSheet(rows);
  elements.applyImportButton.disabled = pendingImport.updates.length === 0;
  elements.importPreview.innerHTML = `
    <strong>${pendingImport.updates.length}</strong> valores encontrados para atualizar em ${months[state.currentMonth]} de ${state.currentYear}.<br>
    <span>${pendingImport.categoriesFound} linhas reconhecidas por nome de categoria. Valores sem categoria foram ignorados.</span>
  `;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows.filter((line) => line.some((value) => String(value).trim()));
}

function mapRowsToSheet(rows) {
  const sheet = getSheet(state, state.currentLedger, state.currentYear, state.currentMonth);
  const days = daysInMonth(state.currentYear, state.currentMonth);
  const normalizedCategories = sheet.categories.map(normalizeText);
  const updates = [];
  let categoriesFound = 0;

  rows.forEach((row, rowIndex) => {
    const categoryIndex = row.findIndex((cell) => normalizedCategories.includes(normalizeText(cell)));
    if (categoryIndex === -1) return;

    const targetRow = normalizedCategories.indexOf(normalizeText(row[categoryIndex]));
    categoriesFound += 1;

    row.forEach((cell, columnIndex) => {
      if (columnIndex === categoryIndex) return;
      const day = detectDay(rows, rowIndex, columnIndex, days);
      const value = parseValue(cell);
      if (day && value) updates.push({ row: targetRow, day, value });
    });
  });

  return { updates, categoriesFound };
}

function detectDay(rows, rowIndex, columnIndex, maxDay) {
  const candidates = [
    rows[0]?.[columnIndex],
    rows[1]?.[columnIndex],
    rows[Math.max(0, rowIndex - 1)]?.[columnIndex]
  ];

  for (const candidate of candidates) {
    const day = parseDay(candidate, maxDay);
    if (day) return day;
  }

  const fallback = columnIndex;
  return fallback >= 1 && fallback <= maxDay ? fallback : null;
}

function parseDay(value, maxDay) {
  const text = String(value || "").trim();
  const dateMatch = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  const plainMatch = text.match(/\b(\d{1,2})\b/);
  const day = dateMatch ? Number(dateMatch[1]) : plainMatch ? Number(plainMatch[1]) : 0;
  return day >= 1 && day <= maxDay ? day : null;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function applyImport() {
  if (!pendingImport) return;
  const sheet = getSheet(state, state.currentLedger, state.currentYear, state.currentMonth);
  pendingImport.updates.forEach(({ row, day, value }) => {
    sheet.values[row][day] = value;
  });
  saveState();
  elements.importDialog.close();
  render();
}

function exportWorkbook() {
  if (!window.XLSX) {
    exportHtmlWorkbook();
    return;
  }

  const workbook = window.XLSX.utils.book_new();
  const annualRows = [["Ano", "Faturamento", "Compras", "Custos", "Resultado"]];

  state.years.forEach((year) => {
    const annualIncome = getYearTotal("income", year);
    const annualExpense = getYearTotal("expense", year);
    const annualFixed = getYearTotal("fixed", year);
    annualRows.push([year, annualIncome, annualExpense, annualFixed, annualIncome - annualExpense - annualFixed]);

    ledgerTypes.forEach((ledger) => {
      for (let month = 0; month < 12; month += 1) {
        const rows = buildExportRows(ledger, year, month);
        const worksheet = window.XLSX.utils.aoa_to_sheet(rows);
        const namePrefix = ledger === "income" ? "Vendas" : ledger === "fixed" ? "Custos" : "Compras";
        window.XLSX.utils.book_append_sheet(workbook, worksheet, `${namePrefix} ${months[month].slice(0, 3)}-${year}`);
      }
    });
  });

  window.XLSX.utils.book_append_sheet(workbook, window.XLSX.utils.aoa_to_sheet(annualRows), "Totais por ano");
  window.XLSX.writeFile(workbook, `dashboard-loja-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function exportHtmlWorkbook() {
  const sections = [];
  sections.push(`<h1>Totais por ano</h1>${rowsToHtmlTable(buildAnnualExportRows())}`);

  state.years.forEach((year) => {
    ledgerTypes.forEach((ledger) => {
      for (let month = 0; month < 12; month += 1) {
        const title = `${getLedgerLabel(ledger)} - ${months[month]} de ${year}`;
        sections.push(`<h1>${escapeHtml(title)}</h1>${rowsToHtmlTable(buildExportRows(ledger, year, month))}`);
      }
    });
  });

  const html = `
    <html>
      <head>
        <meta charset="UTF-8" />
        <style>
          body { font-family: Arial, sans-serif; }
          h1 { font-size: 18px; margin-top: 24px; }
          table { border-collapse: collapse; margin-bottom: 24px; }
          th, td { border: 1px solid #999; padding: 6px 8px; }
          th { background: #dfeae4; }
        </style>
      </head>
      <body>${sections.join("")}</body>
    </html>
  `;

  downloadBlob(html, `dashboard-loja-${new Date().toISOString().slice(0, 10)}.xls`, "application/vnd.ms-excel");
}

function buildAnnualExportRows() {
  const rows = [["Ano", "Faturamento", "Compras", "Custos", "Resultado"]];
  state.years.forEach((year) => {
    const income = getYearTotal("income", year);
    const expense = getYearTotal("expense", year);
    const fixed = getYearTotal("fixed", year);
    rows.push([year, income, expense, fixed, income - expense - fixed]);
  });
  return rows;
}

function rowsToHtmlTable(rows) {
  return `
    <table>
      ${rows
        .map((row, rowIndex) => {
          const tag = rowIndex === 0 ? "th" : "td";
          return `<tr>${row.map((cell) => `<${tag}>${escapeHtml(cell)}</${tag}>`).join("")}</tr>`;
        })
        .join("")}
    </table>
  `;
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildExportRows(ledger, year, month) {
  const sheet = getSheet(state, ledger, year, month);
  const days = daysInMonth(year, month);
  const label = getLedgerLabel(ledger);
  const rows = [[label, ...Array.from({ length: days }, (_, index) => index + 1), "Total"]];
  const dailyTotals = Array.from({ length: days }, () => 0);
  let monthTotal = 0;

  sheet.categories.forEach((category, rowIndex) => {
    const values = [];
    let rowTotal = 0;
    for (let day = 1; day <= days; day += 1) {
      const value = Number(sheet.values[rowIndex][day] || 0);
      const netValue = getNetValue(ledger, category, value);
      values.push(isDescriptiveLedger(ledger) && sheet.notes?.[rowIndex]?.[day] ? sheet.notes[rowIndex][day] : value || "");
      dailyTotals[day - 1] += netValue;
      rowTotal += netValue;
    }
    monthTotal += rowTotal;
    rows.push([category, ...values, rowTotal]);
  });

  rows.push(["Total diario", ...dailyTotals, monthTotal]);
  return rows;
}

elements.nextYearButton.addEventListener("click", goToNextYear);
elements.nextYearTopButton.addEventListener("click", goToNextYear);
elements.previousYearButton.addEventListener("click", goToPreviousYear);
elements.exportButton.addEventListener("click", exportWorkbook);
elements.saveButton.addEventListener("click", manualSave);
elements.themeToggleButton.addEventListener("click", toggleTheme);
elements.logoutButton.addEventListener("click", logout);
elements.undoButton.addEventListener("click", undoLastChange);
elements.incomeTotal.parentElement.addEventListener("click", toggleIncomeSummaryMode);
elements.applyImportButton.addEventListener("click", applyImport);
elements.fileInput.addEventListener("change", (event) => readImport(event.target.files[0]));

elements.yearSelect.addEventListener("change", (event) => {
  goToYear(Number(event.target.value));
});

document.querySelectorAll(".segment").forEach((button) => {
  button.addEventListener("click", () => {
    state.currentLedger = button.dataset.ledger;
    saveState();
    render();
  });
});

elements.monthTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-month]");
  if (!button) return;
  state.currentMonth = Number(button.dataset.month);
  saveState();
  render();
});

elements.dataTable.addEventListener("change", (event) => {
  if (event.target.matches(".cell-input")) updateCell(event.target);
  if (event.target.matches(".category-input")) updateCategory(event.target);
});

elements.dataTable.addEventListener("click", (event) => {
  if (event.target.matches(".cell-input")) {
    selectCell(event.target, event.shiftKey);
    return;
  }

  const deleteButton = event.target.closest("[data-delete-row]");
  if (deleteButton) {
    deleteRow(Number(deleteButton.dataset.deleteRow));
    return;
  }

  const button = event.target.closest("[data-add-row-end]");
  if (!button) return;
  addRowAtEnd();
});

elements.dataTable.addEventListener("mousedown", (event) => {
  if (event.target.matches(".cell-input")) startCellSelection(event.target, event);
});

elements.dataTable.addEventListener("mouseover", (event) => {
  if (event.target.matches(".cell-input")) extendCellSelection(event.target);
});

document.addEventListener("mouseup", stopCellSelection);

elements.dataTable.addEventListener("dragstart", handleRowDragStart);
elements.dataTable.addEventListener("dragover", handleRowDragOver);
elements.dataTable.addEventListener("drop", handleRowDrop);
elements.dataTable.addEventListener("dragend", handleRowDragEnd);

elements.dataTable.addEventListener("focusin", (event) => {
  if (event.target.matches(".cell-input") || event.target.matches(".category-input")) beginEdit();
  if (event.target.matches(".cell-input")) selectCell(event.target, false);
});

elements.dataTable.addEventListener("input", (event) => {
  if (event.target.matches(".cell-input")) saveCellDraft(event.target);
  if (event.target.matches(".category-input")) saveCategoryDraft(event.target);
});

elements.dataTable.addEventListener(
  "focusout",
  (event) => {
    if (event.target.matches(".cell-input") || event.target.matches(".category-input")) {
      finishEdit();
      render();
    }
  },
  true
);

elements.dataTable.addEventListener("paste", pasteCells);
elements.dataTable.addEventListener("keydown", handleGridShortcuts);
document.addEventListener("copy", copySelectedCells);

async function boot() {
  const allowed = await requireSession();
  if (!allowed) return;
  state = loadState();
  render();
  initCloudSync();
}

boot();
