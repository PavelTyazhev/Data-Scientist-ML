import os
import sys
import json
import time
import uuid
import httpx
import urllib3
import uvicorn
import subprocess
import re
from fastapi import FastAPI, Request, HTTPException, status
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict, Any

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

app = FastAPI(title="Smart Registry of Subscriptions API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ------------------------------------------------------------------
# Constants and Database Helpers
# ------------------------------------------------------------------
DB_PATH = os.path.join(os.getcwd(), 'src/data/subscriptions.json')

def get_db_path() -> str:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    return DB_PATH

def load_subscriptions() -> List[Dict[str, Any]]:
    db_file = get_db_path()
    if not os.path.exists(db_file):
        return []
    try:
        with open(db_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error reading subscriptions: {e}")
        return []

def save_subscriptions(subs: List[Dict[str, Any]]):
    db_file = get_db_path()
    try:
        with open(db_file, 'w', encoding='utf-8') as f:
            json.dump(subs, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"Error saving subscriptions: {e}")
        raise HTTPException(status_code=500, detail="Database write failed")

# ------------------------------------------------------------------
# Tool 1: get_obligations
# ------------------------------------------------------------------
def get_obligations_tool(status_filter: Optional[str] = None, category_filter: Optional[str] = None) -> List[Dict[str, Any]]:
    subs = load_subscriptions()
    filtered = []
    for sub in subs:
        if status_filter and sub.get('status') != status_filter:
            continue
        if category_filter and sub.get('category', '').lower() != category_filter.lower():
            continue
        filtered.append(sub)
    return filtered

# ------------------------------------------------------------------
# Tool 2: convert_currency
# ------------------------------------------------------------------
FALLBACK_RATES = {
    'RUB': 1.0,
    'USD': 90.5,
    'EUR': 98.2,
    'GBP': 115.3,
    'JPY': 0.58,
}

async def convert_currency_tool(amount: float, from_curr: str, to_curr: str) -> Dict[str, Any]:
    from_upper = from_curr.upper()
    to_upper = to_curr.upper()
    
    if amount == 0:
        return {'amount': 0.0, 'source': 'fallback', 'rate': 1.0}
        
    if from_upper == to_upper:
        return {'amount': amount, 'source': 'fallback', 'rate': 1.0}
        
    has_rub = (from_upper == 'RUB' or to_upper == 'RUB')
    
    if not has_rub:
        try:
            url = f"https://api.frankfurter.app/latest?amount={amount}&from={from_upper}&to={to_upper}"
            async with httpx.AsyncClient() as client:
                resp = await client.get(url, timeout=4.0)
                if resp.status_code == 200:
                    data = resp.json()
                    rate = data.get('rates', {}).get(to_upper)
                    if rate is not None:
                        return {
                            'amount': round(amount * rate, 2),
                            'source': 'api',
                            'rate': rate
                        }
        except Exception as e:
            print(f"Frankfurter API failed or timed out: {e}. Falling back to internal rates.")
            
    # Fallback conversion logic
    from_rate = FALLBACK_RATES.get(from_upper)
    to_rate = FALLBACK_RATES.get(to_upper)
    
    if not from_rate or not to_rate:
        raise ValueError(f"Unsupported currency conversion: {from_upper} to {to_upper}")
        
    amount_in_rub = amount * from_rate
    converted_amount = amount_in_rub / to_rate
    effective_rate = from_rate / to_rate
    
    return {
        'amount': round(converted_amount, 2),
        'source': 'fallback',
        'rate': round(effective_rate, 4)
    }

# ------------------------------------------------------------------
# GigaChat Client Helpers
# ------------------------------------------------------------------
cached_giga_token = None
cached_expires_at = 0

async def get_gigachat_token(giga_token: str) -> str:
    global cached_giga_token, cached_expires_at
    now = int(time.time() * 1000)
    if cached_giga_token and cached_expires_at > now + 300000:
        return cached_giga_token
        
    rquid = str(uuid.uuid4())
    print(f"[GigaChat] Fetching new access token with RqUID: {rquid}")
    
    headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'RqUID': rquid,
        'Authorization': f'Bearer {giga_token}'
    }
    
    async with httpx.AsyncClient(verify=False) as client:
        try:
            resp = await client.post(
                'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
                headers=headers,
                content='scope=GIGACHAT_API_PERS'
            )
            if resp.status_code != 200:
                print(f"[GigaChat] scope GIGACHAT_API_PERS failed ({resp.status_code}): {resp.text}. Retrying with GIGACHAT_API_CORP...")
                resp = await client.post(
                    'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
                    headers=headers,
                    content='scope=GIGACHAT_API_CORP'
                )
                if resp.status_code != 200:
                    raise Exception(f"GigaChat Authentication failed for both scopes. PERS status: {resp.status_code}, Error: {resp.text}")
            
            data = resp.json()
            cached_giga_token = data['access_token']
            cached_expires_at = data['expires_at']
            print("[GigaChat] Successfully authenticated. Token cached.")
            return cached_giga_token
        except Exception as e:
            print(f"[GigaChat] Oauth fetch failed: {e}")
            raise e

async def fetch_gigachat_completion(access_token: str, messages: List[Dict[str, Any]]) -> str:
    headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': f'Bearer {access_token}'
    }
    
    payload = {
        'model': 'GigaChat',
        'messages': messages,
        'temperature': 0.1,
        'stream': False,
        'response_format': { 'type': 'json_object' }
    }
    
    async with httpx.AsyncClient(verify=False) as client:
        resp = await client.post(
            'https://gigachat.devices.sberbank.ru/api/v1/chat/completions',
            headers=headers,
            json=payload,
            timeout=60.0
        )
        if resp.status_code != 200:
            raise Exception(f"GigaChat completion failed: {resp.status_code} - {resp.text}")
        
        data = resp.json()
        if not data.get('choices'):
            raise Exception("GigaChat returned empty choices")
        return data['choices'][0]['message']['content']

def clean_and_parse_json(text: str) -> Any:
    cleaned = text.strip()
    if cleaned.startswith('```json'):
        cleaned = cleaned[7:]
    elif cleaned.startswith('```'):
        cleaned = cleaned[3:]
    if cleaned.endswith('```'):
        cleaned = cleaned[:-3]
    cleaned = cleaned.strip()
    
    # Remove trailing commas
    cleaned = re.sub(r',(\s*[\]}])', r'\1', cleaned)
    
    return json.loads(cleaned)

# ------------------------------------------------------------------
# Request Schemas
# ------------------------------------------------------------------
class SubscriptionCreate(BaseModel):
    title: str
    amount: float
    currency: str
    category: str
    next_payment_date: str
    status: str

class SubscriptionUpdate(BaseModel):
    title: Optional[str] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    category: Optional[str] = None
    next_payment_date: Optional[str] = None
    status: Optional[str] = None

class AgentQuery(BaseModel):
    query: str

# ------------------------------------------------------------------
# CRUD API Endpoints
# ------------------------------------------------------------------
@app.get("/api/subscriptions")
def get_subscriptions():
    try:
        return load_subscriptions()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/subscriptions", status_code=status.HTTP_201_CREATED)
def create_subscription(sub: SubscriptionCreate):
    try:
        subs = load_subscriptions()
        new_sub = {
            "id": f"sub-{int(time.time() * 1000)}",
            "title": sub.title,
            "amount": sub.amount,
            "currency": sub.currency.upper(),
            "category": sub.category.lower(),
            "next_payment_date": sub.next_payment_date,
            "status": sub.status
        }
        subs.append(new_sub)
        save_subscriptions(subs)
        return new_sub
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/subscriptions/{sub_id}")
def update_subscription(sub_id: str, sub: SubscriptionUpdate):
    try:
        subs = load_subscriptions()
        idx = next((i for i, s in enumerate(subs) if s['id'] == sub_id), -1)
        if idx == -1:
            raise HTTPException(status_code=404, detail="Subscription not found")
        
        if sub.title is not None:
            subs[idx]['title'] = sub.title
        if sub.amount is not None:
            subs[idx]['amount'] = sub.amount
        if sub.currency is not None:
            subs[idx]['currency'] = sub.currency.upper()
        if sub.category is not None:
            subs[idx]['category'] = sub.category.lower()
        if sub.next_payment_date is not None:
            subs[idx]['next_payment_date'] = sub.next_payment_date
        if sub.status is not None:
            subs[idx]['status'] = sub.status
            
        save_subscriptions(subs)
        return subs[idx]
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/subscriptions/{sub_id}")
def delete_subscription(sub_id: str):
    try:
        subs = load_subscriptions()
        initial_len = len(subs)
        subs = [s for s in subs if s['id'] != sub_id]
        if len(subs) == initial_len:
            raise HTTPException(status_code=404, detail="Subscription not found")
        save_subscriptions(subs)
        return {"success": True}
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ------------------------------------------------------------------
# Run Unit Tests Endpoint
# ------------------------------------------------------------------
@app.post("/api/tests/run")
async def run_tests():
    try:
        results = []
        
        # Test 1: get_obligations returns full list of subscriptions
        try:
            lst = get_obligations_tool()
            passed = len(lst) >= 10
            results.append({
                'name': 'get_obligations: Returns all subscriptions',
                'passed': passed,
                'message': f'Successfully loaded {len(lst)} subscriptions from JSON file.',
                'expected': 'At least 10 subscriptions',
                'actual': f'{len(lst)} subscriptions'
            })
        except Exception as e:
            results.append({
                'name': 'get_obligations: Returns all subscriptions',
                'passed': False,
                'error': str(e)
            })

        # Test 2: get_obligations status and category filtering
        try:
            active_subs = get_obligations_tool('active', 'subscription')
            all_active_valid = all(s.get('status') == 'active' and s.get('category') == 'subscription' for s in active_subs)
            passed = len(active_subs) > 0 and all_active_valid
            results.append({
                'name': 'get_obligations: Filters by status and category',
                'passed': passed,
                'message': f'Found {len(active_subs)} active subscription-category items. All match criteria.',
                'expected': 'Only items with status="active" and category="subscription"',
                'actual': f'Found {len(active_subs)} items. All criteria match: {all_active_valid}'
            })
        except Exception as e:
            results.append({
                'name': 'get_obligations: Filters by status and category',
                'passed': False,
                'error': str(e)
            })

        # Test 3: convert_currency with same currency conversion
        try:
            conversion = await convert_currency_tool(150.0, 'USD', 'USD')
            passed = conversion['amount'] == 150.0 and conversion['rate'] == 1.0
            results.append({
                'name': 'convert_currency: Same-currency conversion',
                'passed': passed,
                'message': f"Converting 150 USD to USD yielded {conversion['amount']} with rate {conversion['rate']}.",
                'expected': 'Amount: 150, Rate: 1',
                'actual': f"Amount: {conversion['amount']}, Rate: {conversion['rate']}"
            })
        except Exception as e:
            results.append({
                'name': 'convert_currency: Same-currency conversion',
                'passed': False,
                'error': str(e)
            })

        # Test 4: convert_currency using internal fallback rates for RUB
        try:
            conversion = await convert_currency_tool(10.0, 'USD', 'RUB')
            expected_amount = 905.0 # 10 * 90.5
            passed = conversion['amount'] == expected_amount and conversion['source'] == 'fallback'
            results.append({
                'name': 'convert_currency: Fallback rate conversion (USD to RUB)',
                'passed': passed,
                'message': f"Converting 10 USD to RUB yielded {conversion['amount']} RUB (expected {expected_amount} RUB) via {conversion['source']}.",
                'expected': f'Amount: {expected_amount}, Source: fallback',
                'actual': f"Amount: {conversion['amount']}, Source: {conversion['source']}"
            })
        except Exception as e:
            results.append({
                'name': 'convert_currency: Fallback rate conversion (USD to RUB)',
                'passed': False,
                'error': str(e)
            })

        # Test 5: convert_currency cross-conversion between currencies
        try:
            conversion = await convert_currency_tool(100.0, 'EUR', 'USD')
            passed = conversion['amount'] > 0 and isinstance(conversion['rate'], (int, float))
            results.append({
                'name': 'convert_currency: Cross-currency conversion (EUR to USD)',
                'passed': passed,
                'message': f"Converting 100 EUR to USD yielded {conversion['amount']} USD via {conversion['source']} (Rate: {conversion['rate']}).",
                'expected': 'Amount > 0 and rate is a valid number',
                'actual': f"Amount: {conversion['amount']}, Source: {conversion['source']}, Rate: {conversion['rate']}"
            })
        except Exception as e:
            results.append({
                'name': 'convert_currency: Cross-currency conversion (EUR to USD)',
                'passed': False,
                'error': str(e)
            })

        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ------------------------------------------------------------------
# ReAct AI Agent Loop Endpoint
# ------------------------------------------------------------------
@app.post("/api/agent/chat")
async def agent_chat(payload: AgentQuery):
    query = payload.query
    giga_token = os.environ.get('GIGACHAT_TOKEN', 'MDE5OWU5MDItY2IxNi03MDVmLTllZjMtOWZkY2UwZWE0ZjQ4OmRjYTUwZDU0LTA2NTctNGU1Zi05ZGNlLWIwZDU5YjQ4NTQ1Mg==')
    if not giga_token:
        raise HTTPException(
            status_code=400,
            detail="GigaChat token not configured. Пожалуйста, настройте GIGACHAT_TOKEN в Secrets."
        )
        
    try:
        print("[AI Agent] Obtaining GigaChat Access Token...")
        access_token = await get_gigachat_token(giga_token)
        
        steps = []
        is_done = False
        iterations = 0
        max_iterations = 8
        
        print(f"[AI Agent] Initializing GigaChat ReAct loop for user query: \"{query}\"")
        
        system_instruction = (
            "Вы — опытный финансовый ИИ-агент Платформы «Умный реестр подписок» (Smart Registry of Subscriptions).\n"
            "Ваша задача — отвечать на вопросы пользователя по его личным подпискам, регулярным платежам, обязательствам и финансовым планам.\n"
            "Текущее время/дата для расчетов: 2026-07-15 (Среда). Все расчеты \"этой недели\", \"ближайших 30 дней\" делайте относительно этой даты!\n\n"
            "Вы строго следуете циклу рассуждений ReAct:\n"
            "1. Думаете (Thought): Анализируете, какая информация вам нужна или как объединить имеющиеся данные.\n"
            "2. Вызываете Инструмент (Action): Запрашиваете данные или конвертацию валют.\n"
            "3. Получаете результат (Observation): Анализируете полученные данные.\n"
            "4. Выдаете Финальный Ответ (Final Answer): Подробный, точный, обоснованный ответ на русском языке.\n\n"
            "В вашем распоряжении два инструмента:\n"
            "1) get_obligations(status: \"active\" | \"inactive\" | null, category: string | null): Возвращает список подписок, соответствующих фильтрам. Поля записей: id, title, amount, currency, category, next_payment_date, status.\n"
            "2) convert_currency(amount: number, from: string, to: string): Конвертирует сумму из одной валюты в другую. Возвращает объект { amount: number, source: 'api' | 'fallback', rate: number }.\n\n"
            "Вы ДОЛЖНЫ возвращать JSON-объект следующего формата на каждом шаге:\n"
            "{\n"
            "  \"thought\": \"Ваш внутренний шаг рассуждений (Thought). Подумайте, что вам нужно сделать, какой инструмент использовать и почему. Произведите фильтрацию, расчеты или валютные сложения прямо здесь.\",\n"
            "  \"action\": {\n"
            "    \"name\": \"get_obligations\" или \"convert_currency\",\n"
            "    \"args\": { ...параметры... }\n"
            "  },\n"
            "  \"finalAnswer\": \"Окончательный подробный ответ пользователю (Final Answer) на русском языке. Заполняйте только когда у вас есть все нужные данные.\"\n"
            "}\n\n"
            "КРИТИЧЕСКИЕ ПРАВИЛА:\n"
            "- Если вы уже вызвали get_obligations хотя бы один раз, у вас уже есть все подписки! Не нужно вызывать его снова с пустыми или аналогичными аргументами.\n"
            "- НЕ вызывайте get_obligations повторно для фильтрации подписок по датам следующего платежа (next_payment_date), подсчета сумм или поиска конкретных подписок по названию/категории. Сделайте все эти операции фильтрации, группировки и расчетов самостоятельно в уме (в поле \"thought\"), используя данные из предыдущего Observation!\n"
            "- Если у вас достаточно данных, чтобы полностью ответить на вопрос, заполните поля 'thought' и 'finalAnswer' (на русском языке). При этом поле 'action' должно полностью отсутствовать или быть null.\n"
            "- Никогда не галлюцинируйте числа или курсы валют. Если API курсов не работает и у вас нет fallback данных, сообщите об этом.\n"
            "- Будьте точны в расчетах. Всегда объясняйте, как вы получили итоговую сумму (например, какие подписки сложили, по какому курсу перевели)."
        )
        
        while not is_done and iterations < max_iterations:
            iterations += 1
            print(f"[AI Agent] ReAct Iteration {iterations}")
            
            prompt_context = f"Запрос пользователя: \"{query}\"\n\n"
            prompt_context += "История выполнения шагов ReAct (используйте эти данные, чтобы не делать повторных запросов!):\n"
            
            if len(steps) == 0:
                prompt_context += "(Еще нет выполненных шагов. Начните с получения списка обязательств пользователя или планирования.)\n"
            else:
                for idx, step in enumerate(steps):
                    prompt_context += f"Шаг {idx + 1}:\n"
                    prompt_context += f"- Thought: {step['thought']}\n"
                    if step.get('action'):
                        prompt_context += f"- Action: {step['action']['name']}({json.dumps(step['action']['args'])})\n"
                        if step.get('error'):
                            prompt_context += f"- Observation Error: {step['error']}\n"
                        else:
                            prompt_context += f"- Observation: {step['observation']}\n"
            
            if len(steps) > 0:
                prompt_context += (
                    "\nВНИМАНИЕ: Вы уже получили данные подписок в предыдущих шагах. НЕ ВЫЗЫВАЙТЕ get_obligations СНОВА! "
                    "Отфильтруйте подписки (например, по датам этой недели с 2026-07-15 по 2026-07-21) и сделайте все "
                    "математические подсчеты самостоятельно в поле \"thought\". Сформулируйте подробный ответ на русском языке "
                    "и верните его в поле \"finalAnswer\", оставив поле \"action\" пустым.\n"
                )
                
            prompt_context += "\nСделайте следующий шаг рассуждений. Верните строго JSON-объект, содержащий 'thought' и либо 'action', либо 'finalAnswer'."
            
            messages = [
                {'role': 'system', 'content': system_instruction},
                {'role': 'user', 'content': prompt_context}
            ]
            
            text_response = await fetch_gigachat_completion(access_token, messages)
            print(f"[AI Agent] GigaChat Response (Raw JSON):\n{text_response}")
            
            try:
                step_result = clean_and_parse_json(text_response)
            except Exception as err:
                print(f"[AI Agent] Failed to parse JSON from GigaChat response: {err}")
                raise HTTPException(status_code=502, detail="GigaChat returned an invalid JSON response")
                
            current_step_id = f"step-{int(time.time() * 1000)}-{iterations}"
            new_step = {
                'id': current_step_id,
                'thought': step_result.get('thought', 'Рассматриваю финансовые данные.'),
                'timestamp': time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            
            has_get_obligations_call = any(s.get('action', {}).get('name') == 'get_obligations' for s in steps)
            
            action_data = step_result.get('action')
            final_answer = step_result.get('finalAnswer')
            
            if action_data and action_data.get('name') and (not has_get_obligations_call or action_data.get('name') != 'get_obligations'):
                action_name = action_data['name']
                action_args = action_data.get('args', {})
                
                new_step['action'] = {
                    'name': action_name,
                    'args': action_args
                }
                
                print(f"[AI Agent] Calling tool: {action_name} with args: {action_args}")
                
                try:
                    if action_name == 'get_obligations':
                        obs = get_obligations_tool(action_args.get('status'), action_args.get('category'))
                        new_step['observation'] = json.dumps(obs, ensure_ascii=False)
                    elif action_name == 'convert_currency':
                        obs = await convert_currency_tool(
                            float(action_args.get('amount', 0)),
                            str(action_args.get('from') or action_args.get('from_currency') or action_args.get('from_currency_code') or 'USD'),
                            str(action_args.get('to') or action_args.get('to_currency') or action_args.get('to_currency_code') or 'RUB')
                        )
                        new_step['observation'] = json.dumps(obs, ensure_ascii=False)
                    else:
                        new_step['error'] = f"Инструмент \"{action_name}\" не поддерживается."
                        print(f"[AI Agent] Tool \"{action_name}\" not found.")
                except Exception as tool_err:
                    new_step['error'] = f"Ошибка вызова инструмента: {tool_err}"
                    print(f"[AI Agent] Tool error in {action_name}: {tool_err}")
                
                print(f"[AI Agent] Tool result (Observation): {new_step.get('error') or new_step.get('observation')}")
                
            elif final_answer:
                is_done = True
                new_step['observation'] = 'Завершено: Финальный ответ получен.'
                print(f"[AI Agent] Final Answer reached: {final_answer}")
                
            elif action_data and action_data.get('name') == 'get_obligations' and has_get_obligations_call:
                # Prevent infinite loop by returning cached get_obligations output
                prev_step = next((s for s in steps if s.get('action', {}).get('name') == 'get_obligations' and s.get('observation')), None)
                new_step['action'] = {
                    'name': action_data['name'],
                    'args': action_data.get('args', {})
                }
                new_step['observation'] = prev_step['observation'] if prev_step else '[]'
                new_step['error'] = 'Предупреждение: Вы повторно запросили список обязательств. Все данные уже были получены на Шаге 1. Пожалуйста, используйте их для финального ответа.'
                print('[AI Agent] Intercepted repeating get_obligations tool call to prevent infinite loop.')
                
            else:
                new_step['error'] = 'Агент не вернул ни action, ни finalAnswer.'
                is_done = True
                print('[AI Agent] Stuck: returned neither action nor finalAnswer.')
                
            steps.append(new_step)
            
            if is_done:
                return {
                    'query': query,
                    'answer': final_answer or 'Не удалось сформировать ответ.',
                    'steps': steps
                }
                
        # If we exceeded maxIterations
        return {
            'query': query,
            'answer': 'Агент превысил максимальное число шагов рассуждений (8) и остановился из соображений безопасности.',
            'steps': steps
        }
        
    except Exception as e:
        print(f"[AI Agent] Error in agent chat API: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Internal server error: {e}"
        )

# ------------------------------------------------------------------
# Vite Integration & Static Assets Serving / Proxy
# ------------------------------------------------------------------
@app.api_route("/{path_name:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD", "PATCH"])
async def catch_all_or_proxy(request: Request, path_name: str):
    if path_name.startswith("api/"):
        raise HTTPException(status_code=404, detail="API endpoint not found")
        
    is_prod = os.environ.get("NODE_ENV") == "production" or not os.path.exists("src/main.tsx")
    
    if is_prod:
        # Serve static build from dist folder
        dist_path = os.path.join(os.getcwd(), 'dist')
        if not os.path.exists(dist_path):
            raise HTTPException(status_code=500, detail="Production static directory 'dist' not found. Please run npm run build.")
            
        target_file = os.path.join(dist_path, path_name)
        if os.path.exists(target_file) and os.path.isfile(target_file):
            return FileResponse(target_file)
        # Fallback to index.html for SPA
        return FileResponse(os.path.join(dist_path, 'index.html'))
        
    else:
        # Proxy to Vite dev server on port 3001
        async with httpx.AsyncClient() as client:
            url = f"http://localhost:3001/{path_name}"
            if request.query_params:
                url += f"?{request.query_params}"
                
            headers = dict(request.headers)
            headers.pop("host", None)
            
            try:
                resp = await client.request(
                    method=request.method,
                    url=url,
                    headers=headers,
                    content=await request.body(),
                    timeout=10.0
                )
                return StreamingResponse(
                    resp.iter_bytes(),
                    status_code=resp.status_code,
                    headers=dict(resp.headers)
                )
            except Exception as e:
                return JSONResponse(
                    status_code=502,
                    content={"detail": f"Vite dev server is offline or launching: {e}"}
                )

# ------------------------------------------------------------------
# Background process startup
# ------------------------------------------------------------------
if __name__ == "__main__":
    is_prod = os.environ.get("NODE_ENV") == "production" or not os.path.exists("src/main.tsx")
    
    if not is_prod:
        # Start Vite dev server on port 3001 in development mode
        print("[System] Launching Vite development server in background on port 3001...")
        subprocess.Popen(
            ["npx", "vite", "--port", "3001", "--strictPort"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        
    print("[System] Starting FastAPI server on port 3000...")
    uvicorn.run("server:app", host="0.0.0.0", port=3000, log_level="info")
