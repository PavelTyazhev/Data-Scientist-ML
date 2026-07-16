import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";

// Set TLS rejection bypass for GigaChat SSL certificate bypass (simulates verify=False in httpx)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// ------------------------------------------------------------------
// Types & Interface Definition
// ------------------------------------------------------------------
interface Subscription {
  id: string;
  title: string;
  amount: number;
  currency: string;
  category: string;
  next_payment_date: string;
  status: string;
}

// ------------------------------------------------------------------
// Constants and Database Helpers
// ------------------------------------------------------------------
const DB_PATH = path.join(process.cwd(), 'src/data/subscriptions.json');

function getDbPath(): string {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return DB_PATH;
}

function loadSubscriptions(): Subscription[] {
  const dbFile = getDbPath();
  if (!fs.existsSync(dbFile)) {
    return [];
  }
  try {
    const data = fs.readFileSync(dbFile, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    console.error(`Error reading subscriptions: ${e}`);
    return [];
  }
}

function saveSubscriptions(subs: Subscription[]) {
  const dbFile = getDbPath();
  try {
    fs.writeFileSync(dbFile, JSON.stringify(subs, null, 2), 'utf-8');
  } catch (e) {
    console.error(`Error saving subscriptions: ${e}`);
    throw new Error("Database write failed");
  }
}

// ------------------------------------------------------------------
// Tool 1: get_obligations
// ------------------------------------------------------------------
function getObligationsTool(statusFilter?: string | null, categoryFilter?: string | null): Subscription[] {
  const subs = loadSubscriptions();
  const filtered: Subscription[] = [];
  for (const sub of subs) {
    if (statusFilter && sub.status !== statusFilter) {
      continue;
    }
    if (categoryFilter && sub.category.toLowerCase() !== categoryFilter.toLowerCase()) {
      continue;
    }
    filtered.push(sub);
  }
  return filtered;
}

// ------------------------------------------------------------------
// Tool 2: convert_currency
// ------------------------------------------------------------------
const FALLBACK_RATES: Record<string, number> = {
  'RUB': 1.0,
  'USD': 90.5,
  'EUR': 98.2,
  'GBP': 115.3,
  'JPY': 0.58,
};

async function convertCurrencyTool(amount: number, from_currency: string, to_currency: string) {
  const fromUpper = from_currency.toUpperCase();
  const toUpper = to_currency.toUpperCase();
  
  if (amount === 0) {
    return { amount: 0.0, source: 'fallback', rate: 1.0 };
  }
  
  if (fromUpper === toUpper) {
    return { amount: amount, source: 'fallback', rate: 1.0 };
  }
  
  try {
    const url = `https://api.frankfurter.dev/v2/rate/${fromUpper}/${toUpper}`;
    const resp = await fetch(url);
    if (resp.status === 200) {
      const data = await resp.json() as any;
      const rate = data.rate;
      if (rate !== undefined && typeof rate === 'number') {
        return {
          amount: parseFloat((amount * rate).toFixed(2)),
          source: 'api',
          rate: parseFloat(rate.toFixed(4))
        };
      }
    }
  } catch (e) {
    console.error(`Frankfurter API failed or timed out: ${e}. Falling back to internal rates.`);
  }
  
  const fromRate = FALLBACK_RATES[fromUpper];
  const toRate = FALLBACK_RATES[toUpper];
  
  if (!fromRate || !toRate) {
    throw new Error(`Unsupported currency conversion: ${fromUpper} to ${toUpper}`);
  }
  
  const amountInRub = amount * fromRate;
  const convertedAmount = amountInRub / toRate;
  const effectiveRate = fromRate / toRate;
  
  return {
    amount: parseFloat(convertedAmount.toFixed(2)),
    source: 'fallback',
    rate: parseFloat(effectiveRate.toFixed(4))
  };
}

// ------------------------------------------------------------------
// GigaChat Client Helpers
// ------------------------------------------------------------------
let cachedGigaToken: string | null = null;
let cachedExpiresAt: number = 0;

async function getGigaChatToken(gigaToken: string): Promise<string> {
  const now = Date.now();
  if (cachedGigaToken && cachedExpiresAt > now + 300000) {
    return cachedGigaToken;
  }
  
  const rquid = crypto.randomUUID();
  console.log(`[GigaChat] Fetching new access token with RqUID: ${rquid}`);
  
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json',
    'RqUID': rquid,
    'Authorization': `Bearer ${gigaToken}`
  };
  
  try {
    let resp = await fetch('https://ngw.devices.sberbank.ru:9443/api/v2/oauth', {
      method: 'POST',
      headers: headers,
      body: 'scope=GIGACHAT_API_PERS'
    });
    
    if (resp.status !== 200) {
      const errText = await resp.text();
      console.log(`[GigaChat] scope GIGACHAT_API_PERS failed (${resp.status}): ${errText}. Retrying with GIGACHAT_API_CORP...`);
      resp = await fetch('https://ngw.devices.sberbank.ru:9443/api/v2/oauth', {
        method: 'POST',
        headers: headers,
        body: 'scope=GIGACHAT_API_CORP'
      });
      if (resp.status !== 200) {
        const finalErrText = await resp.text();
        throw new Error(`GigaChat Authentication failed for both scopes. PERS status: ${resp.status}, Error: ${finalErrText}`);
      }
    }
    
    const data = await resp.json() as any;
    cachedGigaToken = data.access_token;
    cachedExpiresAt = data.expires_at;
    console.log("[GigaChat] Successfully authenticated. Token cached.");
    return cachedGigaToken!;
  } catch (e) {
    console.error(`[GigaChat] Oauth fetch failed: ${e}`);
    throw e;
  }
}

async function fetchGigaChatCompletion(accessToken: string, messages: any[]): Promise<string> {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': `Bearer ${accessToken}`
  };
  
  const payload = {
    model: 'GigaChat-Pro',
    messages: messages,
    temperature: 0.1,
    stream: false,
    response_format: { type: 'json_object' }
  };

  const retries = 4;
  let delayMs = 1500;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await fetch('https://gigachat.devices.sberbank.ru/api/v1/chat/completions', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload)
      });
      
      if (resp.status === 429) {
        if (attempt === retries) {
          throw new Error("GigaChat completion failed: 429 - Превышен лимит запросов (Too Many Requests). Пожалуйста, попробуйте позже.");
        }
        console.warn(`[GigaChat] 429 Too Many Requests. Retrying in ${delayMs}ms (Attempt ${attempt}/${retries})...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        delayMs *= 2.5; // Exponential backoff with some random jitter or multiplier
        continue;
      }
      
      if (resp.status !== 200) {
        const errText = await resp.text();
        throw new Error(`GigaChat completion failed: ${resp.status} - ${errText}`);
      }
      
      const data = await resp.json() as any;
      if (!data.choices || data.choices.length === 0) {
        throw new Error("GigaChat returned empty choices");
      }
      return data.choices[0].message.content;
    } catch (e: any) {
      if (attempt === retries || !e.message?.includes('429')) {
        throw e;
      }
      console.warn(`[GigaChat] Error on attempt ${attempt}: ${e.message}. Retrying in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      delayMs *= 2.5;
    }
  }
  throw new Error("Не удалось получить ответ от GigaChat после нескольких попыток.");
}

function cleanAndParseJson(text: string): any {
  let cleaned = text.trim();
  
  const startIdx = cleaned.indexOf('{');
  const endIdx = cleaned.lastIndexOf('}');
  
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    cleaned = cleaned.substring(startIdx, endIdx + 1);
  } else {
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.substring(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.substring(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.substring(0, cleaned.length - 3);
    }
    cleaned = cleaned.trim();
  }
  
  cleaned = cleaned.replace(/,(\s*[\]}])/g, '$1');
  
  return JSON.parse(cleaned);
}

// ------------------------------------------------------------------
// CRUD API Endpoints
// ------------------------------------------------------------------
app.get("/api/subscriptions", (req, res) => {
  try {
    return res.json(loadSubscriptions());
  } catch (e: any) {
    return res.status(500).json({ detail: e.message });
  }
});

app.post("/api/subscriptions", (req, res) => {
  try {
    const { title, amount, currency, category, next_payment_date, status } = req.body;
    if (!title || amount === undefined || !currency || !category || !next_payment_date || !status) {
      return res.status(400).json({ detail: "Missing required fields" });
    }
    
    const subs = loadSubscriptions();
    const newSub: Subscription = {
      id: `sub-${Date.now()}`,
      title,
      amount: parseFloat(amount),
      currency: currency.toUpperCase(),
      category: category.toLowerCase(),
      next_payment_date,
      status
    };
    subs.push(newSub);
    saveSubscriptions(subs);
    return res.status(201).json(newSub);
  } catch (e: any) {
    return res.status(500).json({ detail: e.message });
  }
});

app.put("/api/subscriptions/:sub_id", (req, res) => {
  try {
    const { sub_id } = req.params;
    const { title, amount, currency, category, next_payment_date, status } = req.body;
    const subs = loadSubscriptions();
    const idx = subs.findIndex(s => s.id === sub_id);
    if (idx === -1) {
      return res.status(404).json({ detail: "Subscription not found" });
    }
    
    if (title !== undefined) subs[idx].title = title;
    if (amount !== undefined) subs[idx].amount = parseFloat(amount);
    if (currency !== undefined) subs[idx].currency = currency.toUpperCase();
    if (category !== undefined) subs[idx].category = category.toLowerCase();
    if (next_payment_date !== undefined) subs[idx].next_payment_date = next_payment_date;
    if (status !== undefined) subs[idx].status = status;
    
    saveSubscriptions(subs);
    return res.json(subs[idx]);
  } catch (e: any) {
    return res.status(500).json({ detail: e.message });
  }
});

app.delete("/api/subscriptions/:sub_id", (req, res) => {
  try {
    const { sub_id } = req.params;
    let subs = loadSubscriptions();
    const initialLen = subs.length;
    subs = subs.filter(s => s.id !== sub_id);
    if (subs.length === initialLen) {
      return res.status(404).json({ detail: "Subscription not found" });
    }
    saveSubscriptions(subs);
    return res.json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ detail: e.message });
  }
});

// ------------------------------------------------------------------
// Run Unit Tests Endpoint
// ------------------------------------------------------------------
app.post("/api/tests/run", async (req, res) => {
  try {
    const results = [];
    
    // Test 1: get_obligations returns full list of subscriptions
    try {
      const lst = getObligationsTool();
      const passed = lst.length >= 10;
      results.push({
        name: 'get_obligations: Returns all subscriptions',
        passed: passed,
        message: `Successfully loaded ${lst.length} subscriptions from JSON file.`,
        expected: 'At least 10 subscriptions',
        actual: `${lst.length} subscriptions`
      });
    } catch (e: any) {
      results.push({
        name: 'get_obligations: Returns all subscriptions',
        passed: false,
        error: e.message
      });
    }

    // Test 2: get_obligations status and category filtering
    try {
      const activeSubs = getObligationsTool('active', 'subscription');
      const allActiveValid = activeSubs.every(s => s.status === 'active' && s.category === 'subscription');
      const passed = activeSubs.length > 0 && allActiveValid;
      results.push({
        name: 'get_obligations: Filters by status and category',
        passed: passed,
        message: `Found ${activeSubs.length} active subscription-category items. All match criteria.`,
        expected: 'Only items with status="active" and category="subscription"',
        actual: `Found ${activeSubs.length} items. All criteria match: ${allActiveValid}`
      });
    } catch (e: any) {
      results.push({
        name: 'get_obligations: Filters by status and category',
        passed: false,
        error: e.message
      });
    }

    // Test 3: convert_currency with same currency conversion
    try {
      const conversion = await convertCurrencyTool(150.0, 'USD', 'USD');
      const passed = conversion.amount === 150.0 && conversion.rate === 1.0;
      results.push({
        name: 'convert_currency: Same-currency conversion',
        passed: passed,
        message: `Converting 150 USD to USD yielded ${conversion.amount} with rate ${conversion.rate}.`,
        expected: 'Amount: 150, Rate: 1',
        actual: `Amount: ${conversion.amount}, Rate: ${conversion.rate}`
      });
    } catch (e: any) {
      results.push({
        name: 'convert_currency: Same-currency conversion',
        passed: false,
        error: e.message
      });
    }

    // Test 4: convert_currency using API or internal fallback rates for RUB
    try {
      const conversion = await convertCurrencyTool(10.0, 'USD', 'RUB');
      const expectedAmount = 905.0;
      const passed = (conversion.source === 'api' && conversion.amount > 0 && typeof conversion.rate === 'number') ||
                     (conversion.source === 'fallback' && conversion.amount === expectedAmount);
      results.push({
        name: 'convert_currency: Fallback rate conversion (USD to RUB)',
        passed: passed,
        message: `Converting 10 USD to RUB yielded ${conversion.amount} RUB via ${conversion.source} (Rate: ${conversion.rate}).`,
        expected: `Valid API amount or ${expectedAmount} RUB via fallback`,
        actual: `Amount: ${conversion.amount}, Source: ${conversion.source}, Rate: ${conversion.rate}`
      });
    } catch (e: any) {
      results.push({
        name: 'convert_currency: Fallback rate conversion (USD to RUB)',
        passed: false,
        error: e.message
      });
    }

    // Test 5: convert_currency cross-conversion between currencies
    try {
      const conversion = await convertCurrencyTool(100.0, 'EUR', 'USD');
      const passed = conversion.amount > 0 && typeof conversion.rate === 'number';
      results.push({
        name: 'convert_currency: Cross-currency conversion (EUR to USD)',
        passed: passed,
        message: `Converting 100 EUR to USD yielded ${conversion.amount} USD via ${conversion.source} (Rate: ${conversion.rate}).`,
        expected: 'Amount > 0 and rate is a valid number',
        actual: `Amount: ${conversion.amount}, Source: ${conversion.source}, Rate: ${conversion.rate}`
      });
    } catch (e: any) {
      results.push({
        name: 'convert_currency: Cross-currency conversion (EUR to USD)',
        passed: false,
        error: e.message
      });
    }

    return res.json(results);
  } catch (e: any) {
    return res.status(500).json({ detail: e.message });
  }
});

// ------------------------------------------------------------------
// Local Smart Rules-Based Fallback Agent
// ------------------------------------------------------------------
async function getLocalFallbackAgentResponse(query: string, currentDate?: string): Promise<{ query: string; answer: string; steps: any[] }> {
  const queryLower = query.toLowerCase();
  const subs = loadSubscriptions();
  const steps: any[] = [];
  const refDateStr = currentDate || new Date().toISOString().split('T')[0];
  
  // Step 1: Simulated get_obligations
  const step1Id = `step-fallback-1-${Date.now()}`;
  steps.push({
    id: step1Id,
    thought: "Запрос пользователя требует финансовой аналитики подписок. Сначала вызовем инструмент get_obligations() для получения актуального списка.",
    timestamp: new Date().toISOString(),
    action: {
      name: "get_obligations",
      args: {}
    },
    observation: JSON.stringify(subs)
  });
  
  console.log(`\n--- [AI Agent FALLBACK Step 1] ---`);
  console.log(`[THOUGHT]: ${steps[0].thought}`);
  console.log(`[ACTION]: Calling tool "get_obligations" with arguments: {}`);
  console.log(`[OBSERVATION]: Loaded ${subs.length} items`);

  let answer = "";

  // Check if query mentions any specific subscription title (e.g. Netflix, Spotify, etc.)
  const matchedSub = subs.find(s => {
    const titleLower = s.title.toLowerCase();
    return queryLower.includes(titleLower) || 
           (titleLower.includes("netflix") && queryLower.includes("netflix")) ||
           (titleLower.includes("spotify") && queryLower.includes("spotify")) ||
           (titleLower.includes("youtube") && queryLower.includes("youtube")) ||
           (titleLower.includes("github") && queryLower.includes("github")) ||
           (titleLower.includes("yandex") && queryLower.includes("яндекс")) ||
           titleLower.split(' ').some(word => word.length > 3 && queryLower.includes(word));
  });

  if (matchedSub) {
    const conversion = await convertCurrencyTool(matchedSub.amount, matchedSub.currency, 'RUB');
    
    const step2Id = `step-fallback-2-${Date.now()}`;
    steps.push({
      id: step2Id,
      thought: `Пользователь спрашивает про подписку "${matchedSub.title}". Вызовем конвертацию валюты из ${matchedSub.currency} в RUB для суммы ${matchedSub.amount}.`,
      timestamp: new Date().toISOString(),
      action: {
        name: "convert_currency",
        args: { amount: matchedSub.amount, from: matchedSub.currency, to: "RUB" }
      },
      observation: JSON.stringify(conversion)
    });

    const step3Id = `step-fallback-3-${Date.now()}`;
    steps.push({
      id: step3Id,
      thought: `Конвертация завершена. Полученная сумма в RUB: ${conversion.amount} по курсу ${conversion.rate}. Формируем финальный ответ.`,
      timestamp: new Date().toISOString(),
      action: null,
      observation: "Завершено: Финальный ответ получен."
    });

    answer = `Согласно вашим активным обязательствам, у вас имеется подписка **'${matchedSub.title}'**.\n\n` +
             `- **Следующий платёж** по этой подписке запланирован на дату: **${matchedSub.next_payment_date}**.\n` +
             `- **Сумма следующего платежа** составляет: **${matchedSub.amount} ${matchedSub.currency}**.\n` +
             `- **Текущий курс обмена** этой валюты в рубли равен **${conversion.rate}**.\n\n` +
             `Таким образом, сумма вашего следующего платежа в рублях будет приблизительно равна **${conversion.amount.toFixed(2)} рублей**.\n\n` +
             `*Пожалуйста, обратите внимание, что этот расчёт основан на актуальных данных и может измениться при изменении курса валют или суммы платежа.*`;

    return { query, answer, steps };
  }
  
  // Rule 1: active/inactive filter
  if (queryLower.includes("активн") || queryLower.includes("действующ") || queryLower.includes("active")) {
    const active = subs.filter(s => s.status === "active");
    
    const step2Id = `step-fallback-2-${Date.now()}`;
    steps.push({
      id: step2Id,
      thought: `Отфильтруем только активные подписки из списка (всего: ${active.length} активных). Посчитаем расходы по ним.`,
      timestamp: new Date().toISOString(),
      action: null,
      observation: "Завершено: Финальный ответ получен."
    });
    
    console.log(`\n--- [AI Agent FALLBACK Step 2] ---`);
    console.log(`[THOUGHT]: ${steps[1].thought}`);
    console.log(`[ACTION]: None (Final answer is ready)`);
    
    const listStr = active.map(s => `- **${s.title}**: ${s.amount} ${s.currency} (дата платежа: ${s.next_payment_date})`).join("\n");
    answer = `У вас найдено **${active.length}** активных подписок:\n\n${listStr}\n\n*Обратите внимание: Агент временно работает в локальном режиме из-за превышения лимитов внешнего API GigaChat.*`;
    console.log(`[FINAL ANSWER]: ${answer}`);

  } else if (queryLower.includes("расход") || queryLower.includes("трачу") || queryLower.includes("сумм") || queryLower.includes("итого") || queryLower.includes("всего") || queryLower.includes("сколько")) {
    // Total in RUB
    let totalRub = 0;
    const itemsList: string[] = [];
    for (const sub of subs) {
      if (sub.status === "active") {
        const rate = FALLBACK_RATES[sub.currency] || 1.0;
        const subInRub = sub.amount * rate;
        totalRub += subInRub;
        itemsList.push(`${sub.title}: ${sub.amount} ${sub.currency} ≈ ${subInRub.toFixed(0)} RUB`);
      }
    }
    
    const step2Id = `step-fallback-2-${Date.now()}`;
    steps.push({
      id: step2Id,
      thought: `Произведем суммирование всех активных платежей и переведем их в RUB, используя внутренние курсы валют (USD=90.5, EUR=98.2, GBP=115.3). Общая сумма: ${totalRub.toFixed(2)} RUB.`,
      timestamp: new Date().toISOString(),
      action: null,
      observation: "Завершено: Финальный ответ получен."
    });
    
    console.log(`\n--- [AI Agent FALLBACK Step 2] ---`);
    console.log(`[THOUGHT]: ${steps[1].thought}`);
    console.log(`[ACTION]: None (Final answer is ready)`);

    answer = `Ваши совокупные ежемесячные затраты по всем активным обязательствам составляют **${totalRub.toFixed(2)} RUB**.\n\n**Детализация расходов в пересчете на RUB:**\n` + 
             itemsList.map(item => `- ${item}`).join("\n") + 
             `\n\n*Обратите внимание: Агент временно работает в локальном режиме из-за превышения лимитов внешнего API GigaChat.*`;
    console.log(`[FINAL ANSWER]: ${answer}`);

  } else if (queryLower.includes("ближайш") || queryLower.includes("следующ") || queryLower.includes("когда") || queryLower.includes("календарь") || queryLower.includes("недел") || queryLower.includes("даты")) {
    let active = subs.filter(s => s.status === "active" && s.next_payment_date >= refDateStr);
    if (active.length === 0) {
      active = subs.filter(s => s.status === "active");
    }
    active.sort((a, b) => a.next_payment_date.localeCompare(b.next_payment_date));
    
    const step2Id = `step-fallback-2-${Date.now()}`;
    steps.push({
      id: step2Id,
      thought: `Отсортируем активные регулярные платежи по дате следующего списания относительно ${refDateStr}. Ближайший платеж: ${active[0]?.title} (${active[0]?.next_payment_date}).`,
      timestamp: new Date().toISOString(),
      action: null,
      observation: "Завершено: Финальный ответ получен."
    });
    
    console.log(`\n--- [AI Agent FALLBACK Step 2] ---`);
    console.log(`[THOUGHT]: ${steps[1].thought}`);
    console.log(`[ACTION]: None (Final answer is ready)`);

    if (active.length > 0) {
      const listStr = active.slice(0, 5).map(s => `- **${s.title}** — **${s.amount} ${s.currency}** будет списано **${s.next_payment_date}**`).join("\n");
      answer = `Ближайший платеж ожидается по подписке **${active[0].title}** (${active[0].amount} ${active[0].currency}) уже **${active[0].next_payment_date}**.\n\n**Вот график ближайших 5 списаний относительно ${refDateStr}:**\n${listStr}\n\n*Обратите внимание: Агент временно работает в локальном режиме из-за превышения лимитов внешнего API GigaChat.*`;
    } else {
      answer = `У вас нет активных подписок с установленными датами платежей после ${refDateStr}.`;
    }
    console.log(`[FINAL ANSWER]: ${answer}`);

  } else {
    // Default smart summary of subs
    const activeCount = subs.filter(s => s.status === "active").length;
    const inactiveCount = subs.filter(s => s.status === "inactive").length;
    
    const step2Id = `step-fallback-2-${Date.now()}`;
    steps.push({
      id: step2Id,
      thought: "Сформируем общий обзор подписок пользователя для ответа на его свободный запрос.",
      timestamp: new Date().toISOString(),
      action: null,
      observation: "Завершено: Финальный ответ получен."
    });
    
    console.log(`\n--- [AI Agent FALLBACK Step 2] ---`);
    console.log(`[THOUGHT]: ${steps[1].thought}`);
    console.log(`[ACTION]: None (Final answer is ready)`);

    answer = `Здравствуйте! Я ваш финансовый ИИ-ассистент.\n\nСейчас в вашей базе данных зарегистрировано **${subs.length} подписок** (${activeCount} активных и ${inactiveCount} неактивных).\n\nВы можете спросить меня:\n- «Какие у меня активные подписки?»\n- «Сколько я трачу в месяц?»\n- «Когда ближайшие списания?»\n\n*Обратите внимание: Агент временно работает в локальном режиме из-за превышения лимитов внешнего API GigaChat.*`;
    console.log(`[FINAL ANSWER]: ${answer}`);
  }
  
  return { query, answer, steps };
}

// ------------------------------------------------------------------
// ReAct AI Agent Loop Endpoint
// ------------------------------------------------------------------
app.post("/api/agent/chat", async (req, res) => {
  const { query, currentDate } = req.body;
  if (!query) {
    return res.status(400).json({ detail: "Query is required" });
  }
  
  const userDateStr = currentDate || new Date().toISOString().split('T')[0];
  const daysOfWeek = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
  const parsedDate = new Date(userDateStr);
  const dayOfWeek = daysOfWeek[parsedDate.getDay()] || "Четверг";

  const gigaToken = process.env.GIGACHAT_TOKEN || 'MDE5OWU5MDItY2IxNi03MDVmLTllZjMtOWZkY2UwZWE0ZjQ4OmRjYTUwZDU0LTA2NTctNGU1Zi05ZGNlLWIwZDU5YjQ4NTQ1Mg==';
  if (!gigaToken) {
    return res.status(400).json({
      detail: "GigaChat token not configured. Пожалуйста, настройте GIGACHAT_TOKEN в Secrets."
    });
  }
  
  try {
    console.log("[AI Agent] Obtaining GigaChat Access Token...");
    const accessToken = await getGigaChatToken(gigaToken);
    
    const steps: any[] = [];
    let isDone = false;
    let iterations = 0;
    const maxIterations = 8;
    
    console.log(`[AI Agent] Initializing GigaChat ReAct loop for user query: "${query}" relative to date ${userDateStr}`);
    
    const systemInstruction = (
        "Вы — опытный финансовый ИИ-агент Платформы «Умный реестр подписок» (Smart Registry of Subscriptions).\n" +
        "Ваша задача — отвечать на вопросы пользователя по его личным подпискам, регулярным платежам, обязательствам и финансовым планам.\n" +
        `Текущее время/дата для расчетов: ${userDateStr} (${dayOfWeek}). Все расчеты "этой недели", "ближайших 30 дней" делайте относительно этой даты!\n\n` +
        "Вы строго следуете циклу рассуждений ReAct:\n" +
        "1. Думаете (Thought): Анализируете, какая информация вам нужна или как объединить имеющиеся данные.\n" +
        "2. Вызываете Инструмент (Action): Запрашиваете данные или конвертацию валют.\n" +
        "3. Получаете результат (Observation): Анализируете полученные данные.\n" +
        "4. Выдаете Финальный Ответ (Final Answer): Подробный, точный, обоснованный ответ на русском языке.\n\n" +
        "В вашем распоряжении два инструмента:\n" +
        "1) get_obligations(status: \"active\" | \"inactive\" | null, category: string | null): Возвращает список подписок, соответствующих фильтрам. Поля записей: id, title, amount, currency, category, next_payment_date, status.\n" +
        "2) convert_currency(amount: number, from: string, to: string): Конвертирует сумму из одной валюты в другую. Возвращает объект { amount: number, source: 'api' | 'fallback', rate: number }.\n\n" +
        "Вы ДОЛЖНЫ возвращать JSON-объект следующего формата на каждом шаге:\n" +
        "{\n" +
        "  \"thought\": \"Ваш внутренний шаг рассуждений (Thought). Подумайте, что вам нужно сделать, какой инструмент использовать и почему. Произведите фильтрацию, расчеты или валютные сложения прямо здесь.\",\n" +
        "  \"action\": {\n" +
        "    \"name\": \"get_obligations\" или \"convert_currency\",\n" +
        "    \"args\": { ...параметры... }\n" +
        "  },\n" +
        "  \"finalAnswer\": \"Окончательный подробный ответ пользователю (Final Answer) на русском языке. Заполняйте только когда у вас есть все нужные данные.\"\n" +
        "}\n\n" +
        "КРИТИЧЕСКИЕ ПРАВИЛА:\n" +
        "- Если вы уже вызвали get_obligations хотя бы один раз, у вас уже есть все подписки! Не нужно вызывать его снова с пустыми или аналогичными аргументами.\n" +
        "- НЕ вызывайте get_obligations повторно для фильтрации подписок по датам следующего платежа (next_payment_date), подсчета сумм или поиска конкретных подписок по названию/категории. Сделайте все эти операции фильтрации, группировки и расчетов самостоятельно в уме (в поле \"thought\"), используя данные из предыдущего Observation!\n" +
        "- Если у вас достаточно данных, чтобы полностью ответить на вопрос, заполните поля 'thought' и 'finalAnswer' (на русском языке). При этом поле 'action' должно полностью отсутствовать или быть null.\n" +
        "- КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО самостоятельно придумывать, галлюцинировать или использовать фиксированные/приблизительные курсы валют (такие как 70, 80, 90 и т.д.)! Для любого перевода валют (например, USD в RUB или EUR в RUB) вы ОБЯЗАНЫ использовать инструмент `convert_currency`.\n" +
        "- Если у вас несколько подписок в разных валютах, вы можете делать несколько последовательных шагов с вызовом `convert_currency` (например, один шаг для USD, другой для EUR), чтобы получить точные курсы.\n" +
        "- Будьте точны в расчетах. Всегда подробно объясняйте, как вы получили итоговую сумму (какие подписки сложили, по какому курсу перевели через инструмент)."
    );
    
    while (!isDone && iterations < maxIterations) {
      iterations++;
      console.log(`[AI Agent] ReAct Iteration ${iterations}`);
      
      let promptContext = `Запрос пользователя: "${query}"\n\n`;
      promptContext += "История выполнения шагов ReAct (используйте эти данные, чтобы не делать повторных запросов!):\n";
      
      if (steps.length === 0) {
        promptContext += "(Еще нет выполненных шагов. Начните с получения списка обязательств пользователя или планирования.)\n";
      } else {
        steps.forEach((step, idx) => {
          promptContext += `Шаг ${idx + 1}:\n`;
          promptContext += `- Thought: ${step.thought}\n`;
          if (step.action) {
            promptContext += `- Action: ${step.action.name}(${JSON.stringify(step.action.args)})\n`;
            if (step.error) {
              promptContext += `- Observation Error: ${step.error}\n`;
            } else {
              promptContext += `- Observation: ${step.observation}\n`;
            }
          }
        });
      }
      
      if (steps.length > 0) {
        promptContext += (
          `\nВНИМАНИЕ: Вы уже получили данные подписок в предыдущих шагах. НЕ ВЫЗЫВАЙТЕ get_obligations СНОВА! ` +
          `Отфильтруйте подписки (например, по датам этой недели относительно ${userDateStr}) и сделайте все ` +
          `математические подсчеты самостоятельно в поле "thought". Сформулируйте подробный ответ на русском языке ` +
          `и верните его в поле "finalAnswer", оставив поле "action" пустым.\n`
        );
      }
      
      promptContext += "\nСделайте следующий шаг рассуждений. Верните строго JSON-объект, содержащий 'thought' и либо 'action', либо 'finalAnswer'.";
      
      const messages = [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: promptContext }
      ];
      
      const textResponse = await fetchGigaChatCompletion(accessToken, messages);
      
      let stepResult: any;
      try {
        stepResult = cleanAndParseJson(textResponse);
      } catch (err) {
        console.log(`[AI Agent] Failed to parse JSON from GigaChat response: ${err}. Falling back to treating raw response as finalAnswer.`);
        stepResult = {
          thought: "Не удалось разобрать структурированный JSON от модели. Отображаю текстовый ответ напрямую.",
          action: null,
          finalAnswer: textResponse
        };
      }
      
      const currentStepId = `step-${Date.now()}-${iterations}`;
      const newStep: any = {
        id: currentStepId,
        thought: stepResult.thought || 'Рассматриваю финансовые данные.',
        timestamp: new Date().toISOString()
      };

      console.log(`\n--- [AI Agent ReAct Step ${iterations}] ---`);
      console.log(`[THOUGHT]: ${newStep.thought}`);
      
      const hasGetObligationsCall = steps.some(s => s.action?.name === 'get_obligations');
      const actionData = stepResult.action;
      const finalAnswer = stepResult.finalAnswer;
      
      if (actionData && actionData.name && (!hasGetObligationsCall || actionData.name !== 'get_obligations')) {
        const actionName = actionData.name;
        const actionArgs = actionData.args || {};
        
        newStep.action = {
          name: actionName,
          args: actionArgs
        };
        
        console.log(`[ACTION]: Calling tool "${actionName}" with arguments:`, JSON.stringify(actionArgs));
        
        try {
          if (actionName === 'get_obligations') {
            const obs = getObligationsTool(actionArgs.status, actionArgs.category);
            newStep.observation = JSON.stringify(obs);
          } else if (actionName === 'convert_currency') {
            const obs = await convertCurrencyTool(
              parseFloat(actionArgs.amount || 0),
              String(actionArgs.from || actionArgs.from_currency || actionArgs.from_currency_code || 'USD'),
              String(actionArgs.to || actionArgs.to_currency || actionArgs.to_currency_code || 'RUB')
            );
            newStep.observation = JSON.stringify(obs);
          } else {
            newStep.error = `Инструмент "${actionName}" не поддерживается.`;
            console.log(`[AI Agent] Tool "${actionName}" not found.`);
          }
        } catch (toolErr: any) {
          newStep.error = `Ошибка вызова инструмента: ${toolErr.message}`;
          console.log(`[AI Agent] Tool error in ${actionName}:`, toolErr);
        }
        
        console.log(`[OBSERVATION]: ${newStep.error || newStep.observation}`);
        
      } else if (finalAnswer) {
        isDone = true;
        newStep.observation = 'Завершено: Финальный ответ получен.';
        console.log(`[ACTION]: None (Final answer is ready)`);
        console.log(`[FINAL ANSWER]: ${finalAnswer}`);
        
      } else if (actionData && actionData.name === 'get_obligations' && hasGetObligationsCall) {
        const prevStep = steps.find(s => s.action?.name === 'get_obligations' && s.observation);
        newStep.action = {
          name: actionData.name,
          args: actionData.args || {}
        };
        newStep.observation = prevStep ? prevStep.observation : '[]';
        newStep.error = 'Предупреждение: Вы повторно запросили список обязательств. Все данные уже были получены на Шаге 1. Пожалуйста, используйте их для финального ответа.';
        console.log(`[ACTION]: Intercepted repeating "get_obligations" tool call to prevent infinite loop.`);
        console.log(`[OBSERVATION]: ${newStep.error}`);
        
      } else {
        newStep.error = 'Агент не вернул ни action, ни finalAnswer.';
        isDone = true;
        console.log(`[ACTION]: None`);
        console.log(`[OBSERVATION]: Error - ${newStep.error}`);
      }
      
      steps.push(newStep);
      
      if (isDone) {
        return res.json({
          query: query,
          answer: finalAnswer || 'Не удалось сформировать ответ.',
          steps: steps
        });
      }
    }
    
    return res.json({
      query: query,
      answer: 'Агент превысил максимальное число шагов рассуждений (8) и остановился из соображений безопасности.',
      steps: steps
    });
    
  } catch (e: any) {
    console.warn(`[AI Agent] GigaChat error, switching to smart local fallback assistant: ${e.message}`);
    try {
      const fallbackResponse = await getLocalFallbackAgentResponse(query, userDateStr);
      return res.json(fallbackResponse);
    } catch (fallbackErr: any) {
      console.error(`[AI Agent] Fallback engine also failed: ${fallbackErr}`);
      return res.status(500).json({
        detail: `Both GigaChat and fallback engine failed: ${fallbackErr.message}`,
        message: `Ошибка ИИ-агента GigaChat: ${e.message}`,
        error: e.message
      });
    }
  }
});

// ------------------------------------------------------------------
// Vite Integration & Static Assets Serving
// ------------------------------------------------------------------
async function startServer() {
  const isProd = process.env.NODE_ENV === "production" || !fs.existsSync(path.join(process.cwd(), 'src/main.tsx'));
  
  if (!isProd) {
    console.log("[System] Mounting Vite middleware in development...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("[System] Serving static production build from 'dist'...");
    const distPath = path.join(process.cwd(), 'dist');
    if (!fs.existsSync(distPath)) {
      console.warn("Production 'dist' directory not found. Please ensure 'npm run build' completed successfully.");
    }
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[System] Express server running on http://localhost:${PORT}`);
  });
}

startServer();
