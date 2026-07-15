export interface Subscription {
  id: string;
  title: string;
  amount: number;
  currency: string;
  category: string;
  next_payment_date: string;
  status: 'active' | 'inactive';
}

export interface ReActStep {
  id: string;
  thought?: string;
  action?: {
    name: string;
    args: any;
  };
  observation?: string;
  error?: string;
  timestamp: string;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'agent' | 'system';
  text: string;
  timestamp: string;
  steps?: ReActStep[];
}

export interface ExchangeRatesResponse {
  amount: number;
  base: string;
  date: string;
  rates: Record<string, number>;
}

export interface UnitTestResult {
  name: string;
  passed: boolean;
  message?: string;
  error?: string;
  expected?: any;
  actual?: any;
}
