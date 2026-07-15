import React, { useState } from 'react';
import { Subscription } from '../types';
import {
  Plus,
  Trash2,
  Edit2,
  Search,
  SlidersHorizontal,
  RefreshCw,
  TrendingUp,
  Calendar,
  Layers,
  Activity,
  AlertTriangle,
  X,
  CheckCircle2,
  XCircle
} from 'lucide-react';

export const CATEGORY_TRANSLATIONS: Record<string, string> = {
  subscription: 'Подписка',
  utility: 'ЖКХ / Услуги',
  telecom: 'Связь и интернет',
  fitness: 'Спорт и здоровье',
  finance: 'Финансы и страхование',
  infrastructure: 'Инфраструктура',
  other: 'Другое',
};

interface DashboardProps {
  subscriptions: Subscription[];
  onRefresh: () => void;
  onAdd: (sub: Omit<Subscription, 'id'>) => Promise<void>;
  onEdit: (id: string, sub: Partial<Subscription>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export default function Dashboard({
  subscriptions,
  onRefresh,
  onAdd,
  onEdit,
  onDelete,
}: DashboardProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    title: '',
    amount: '',
    currency: 'RUB',
    category: 'subscription',
    next_payment_date: '',
    status: 'active' as 'active' | 'inactive',
  });

  // Client-side calculations for dashboard counters (Base currency RUB for uniform view)
  const EXCHANGE_RATES: Record<string, number> = {
    RUB: 1.0,
    USD: 90.5,
    EUR: 98.2,
    GBP: 115.3,
    JPY: 0.58,
  };

  const convertToRub = (amount: number, currency: string) => {
    const rate = EXCHANGE_RATES[currency.toUpperCase()] || 1.0;
    return amount * rate;
  };

  const activeSubscriptions = subscriptions.filter((s) => s.status === 'active');

  // Calculates total spend in RUB in next 30 days (simulation date is 2026-07-15)
  const SIMULATION_DATE = new Date('2026-07-15');
  const THIRTY_DAYS_LATER = new Date('2026-08-14');

  const upcoming30DaysSpendingRub = activeSubscriptions.reduce((acc, sub) => {
    const payDate = new Date(sub.next_payment_date);
    if (payDate >= SIMULATION_DATE && payDate <= THIRTY_DAYS_LATER) {
      return acc + convertToRub(sub.amount, sub.currency);
    }
    return acc;
  }, 0);

  // Calculates total monthly expenses in RUB
  const totalMonthlySpendRub = activeSubscriptions.reduce((acc, sub) => {
    return acc + convertToRub(sub.amount, sub.currency);
  }, 0);

  // Group by category to find most expensive
  const categoryTotals: Record<string, number> = {};
  activeSubscriptions.forEach((sub) => {
    const rubAmount = convertToRub(sub.amount, sub.currency);
    categoryTotals[sub.category] = (categoryTotals[sub.category] || 0) + rubAmount;
  });

  let mostExpensiveCategory = 'Нет';
  let maxCategoryAmount = 0;
  Object.entries(categoryTotals).forEach(([cat, amount]) => {
    if (amount > maxCategoryAmount) {
      maxCategoryAmount = amount;
      mostExpensiveCategory = cat;
    }
  });

  // Unique categories list for filters
  const categories = Array.from(new Set(subscriptions.map((s) => s.category)));

  // Filter subscriptions for display
  const filteredSubscriptions = subscriptions.filter((sub) => {
    const matchesSearch = sub.title.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || sub.category === categoryFilter;
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && sub.status === 'active') ||
      (statusFilter === 'inactive' && sub.status === 'inactive');
    return matchesSearch && matchesCategory && matchesStatus;
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title || !formData.amount || !formData.next_payment_date) return;

    if (editingId) {
      await onEdit(editingId, {
        title: formData.title,
        amount: Number(formData.amount),
        currency: formData.currency,
        category: formData.category,
        next_payment_date: formData.next_payment_date,
        status: formData.status,
      });
      setEditingId(null);
    } else {
      await onAdd({
        title: formData.title,
        amount: Number(formData.amount),
        currency: formData.currency,
        category: formData.category,
        next_payment_date: formData.next_payment_date,
        status: formData.status,
      });
      setIsAdding(false);
    }

    setFormData({
      title: '',
      amount: '',
      currency: 'RUB',
      category: 'subscription',
      next_payment_date: '',
      status: 'active',
    });
  };

  const handleEditClick = (sub: Subscription) => {
    setEditingId(sub.id);
    setFormData({
      title: sub.title,
      amount: String(sub.amount),
      currency: sub.currency,
      category: sub.category,
      next_payment_date: sub.next_payment_date,
      status: sub.status,
    });
    setIsAdding(true);
  };

  const handleCancel = () => {
    setIsAdding(false);
    setEditingId(null);
    setFormData({
      title: '',
      amount: '',
      currency: 'RUB',
      category: 'subscription',
      next_payment_date: '',
      status: 'active',
    });
  };

  const getDaysRemaining = (dateStr: string) => {
    const payDate = new Date(dateStr);
    const diffTime = payDate.getTime() - SIMULATION_DATE.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  return (
    <div className="space-y-6" id="dashboard-root">
      {/* Dynamic Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" id="kpi-grid">
        {/* Card 1: Total Monthly spend */}
        <div className="bg-white p-4 rounded-xl border border-slate-200/80 hover:border-slate-300 transition-all shadow-sm flex items-center justify-between" id="kpi-monthly-spend">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Всего в месяц</p>
            <h3 className="text-xl font-bold font-display text-slate-900 mt-1">
              {totalMonthlySpendRub.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} <span className="text-xs text-slate-500">₽</span>
            </h3>
            <p className="text-[10px] text-slate-400 mt-1">Все активные расходы</p>
          </div>
          <div className="p-3 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-200/60">
            <TrendingUp size={20} />
          </div>
        </div>

        {/* Card 2: Upcoming 30 days */}
        <div className="bg-white p-4 rounded-xl border border-slate-200/80 hover:border-slate-300 transition-all shadow-sm flex items-center justify-between" id="kpi-upcoming">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Ближайшие 30 дней</p>
            <h3 className="text-xl font-bold font-display text-emerald-600 mt-1">
              {upcoming30DaysSpendingRub.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} <span className="text-xs text-slate-500">₽</span>
            </h3>
            <p className="text-[10px] text-emerald-600/80 mt-1">Списания по 14 августа</p>
          </div>
          <div className="p-3 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-200/60">
            <Calendar size={20} />
          </div>
        </div>

        {/* Card 3: Most expensive category */}
        <div className="bg-white p-4 rounded-xl border border-slate-200/80 hover:border-slate-300 transition-all shadow-sm flex items-center justify-between" id="kpi-expensive-cat">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Главная категория</p>
            <h3 className="text-sm font-bold font-display text-indigo-600 mt-1">
              {CATEGORY_TRANSLATIONS[mostExpensiveCategory.toLowerCase()] || mostExpensiveCategory}
            </h3>
            <p className="text-[10px] text-indigo-600/80 mt-1 font-semibold">
              {maxCategoryAmount.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽ в месяц
            </p>
          </div>
          <div className="p-3 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-200/60">
            <Layers size={20} />
          </div>
        </div>

        {/* Card 4: Active subscriptions */}
        <div className="bg-white p-4 rounded-xl border border-slate-200/80 hover:border-slate-300 transition-all shadow-sm flex items-center justify-between" id="kpi-active-subs">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Активно обязательств</p>
            <h3 className="text-xl font-bold font-display text-slate-950 mt-1">
              {activeSubscriptions.length} <span className="text-xs text-slate-400">/ {subscriptions.length}</span>
            </h3>
            <p className="text-[10px] text-slate-400 mt-1">Всего зарегистрировано</p>
          </div>
          <div className="p-3 rounded-lg bg-teal-50 text-teal-600 border border-teal-200/60">
            <Activity size={20} />
          </div>
        </div>
      </div>

      {/* Subscriptions Registry List & Controls */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4" id="registry-panel">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4" id="registry-header">
          <div>
            <h2 className="text-lg font-bold font-display text-slate-900">Реестр регулярных платежей</h2>
            <p className="text-xs text-slate-500">Управляйте вашими финансовыми обязательствами и подписками в реальном времени</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onRefresh}
              className="p-2 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-lg border border-slate-200 hover:border-slate-300 transition-all cursor-pointer"
              title="Обновить данные"
              id="btn-refresh"
            >
              <RefreshCw size={16} />
            </button>
            <button
              onClick={() => setIsAdding(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-medium text-xs rounded-lg transition-all shadow-sm shadow-emerald-100 cursor-pointer"
              id="btn-add-subscription"
            >
              <Plus size={16} />
              <span>Добавить платеж</span>
            </button>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50/80 p-3 rounded-xl border border-slate-200/60" id="filter-toolbar">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
            <input
              type="text"
              placeholder="Поиск по названию..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-4 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500 transition-all"
              id="input-search"
            />
          </div>

          {/* Category Filter */}
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={14} className="text-slate-400 shrink-0" />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-indigo-500 transition-all"
              id="select-category-filter"
            >
              <option value="all">Все категории</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {CATEGORY_TRANSLATIONS[cat.toLowerCase()] || cat}
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-indigo-500 transition-all"
            id="select-status-filter"
          >
            <option value="all">Все статусы</option>
            <option value="active">Активные</option>
            <option value="inactive">Неактивные</option>
          </select>
        </div>

        {/* Add / Edit Subscription Panel overlay inside component */}
        {isAdding && (
          <form
            onSubmit={handleSubmit}
            className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4 shadow-sm"
            id="subscription-form"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <h3 className="text-sm font-semibold text-indigo-600 font-display flex items-center gap-1.5">
                {editingId ? 'Редактировать платеж' : 'Добавить новое финансовое обязательство'}
              </h3>
              <button
                type="button"
                onClick={handleCancel}
                className="text-slate-400 hover:text-slate-600 transition-colors"
                id="btn-close-form"
              >
                <X size={16} />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] text-slate-500 font-medium mb-1">Название услуги *</label>
                <input
                  type="text"
                  required
                  placeholder="Например, Яндекс Плюс, СберПрайм"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-indigo-500 transition-all"
                  id="form-title"
                />
              </div>

              <div>
                <label className="block text-[10px] text-slate-500 font-medium mb-1">Сумма *</label>
                <input
                  type="number"
                  step="any"
                  required
                  placeholder="Например, 399"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-indigo-500 transition-all"
                  id="form-amount"
                />
              </div>

              <div>
                <label className="block text-[10px] text-slate-500 font-medium mb-1">Валюта *</label>
                <select
                  value={formData.currency}
                  onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-indigo-500 transition-all"
                  id="form-currency"
                >
                  <option value="RUB">RUB (₽)</option>
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                  <option value="JPY">JPY (¥)</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] text-slate-500 font-medium mb-1">Категория *</label>
                <select
                  required
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-indigo-500 transition-all"
                  id="form-category"
                >
                  <option value="subscription">Подписка</option>
                  <option value="utility">ЖКХ / Услуги</option>
                  <option value="telecom">Связь и интернет</option>
                  <option value="fitness">Спорт и здоровье</option>
                  <option value="finance">Финансы и страхование</option>
                  <option value="infrastructure">Инфраструктура</option>
                  <option value="other">Другое</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] text-slate-500 font-medium mb-1">Дата следующего списания *</label>
                <input
                  type="date"
                  required
                  value={formData.next_payment_date}
                  onChange={(e) => setFormData({ ...formData, next_payment_date: e.target.value })}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-indigo-500 transition-all"
                  id="form-date"
                />
              </div>

              <div>
                <label className="block text-[10px] text-slate-500 font-medium mb-1">Статус платежа</label>
                <div className="flex gap-4 mt-2">
                  <label className="inline-flex items-center text-xs text-slate-600">
                    <input
                      type="radio"
                      name="status"
                      checked={formData.status === 'active'}
                      onChange={() => setFormData({ ...formData, status: 'active' })}
                      className="mr-1.5 accent-emerald-500"
                    />
                    Активен
                  </label>
                  <label className="inline-flex items-center text-xs text-slate-600">
                    <input
                      type="radio"
                      name="status"
                      checked={formData.status === 'inactive'}
                      onChange={() => setFormData({ ...formData, status: 'inactive' })}
                      className="mr-1.5 accent-slate-500"
                    />
                    Неактивен
                  </label>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 text-xs border-t border-slate-200 pt-3">
              <button
                type="button"
                onClick={handleCancel}
                className="px-3 py-1.5 bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200 rounded-lg transition-all cursor-pointer"
                id="btn-cancel-submit"
              >
                Отмена
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-all font-medium cursor-pointer"
                id="btn-submit-form"
              >
                {editingId ? 'Сохранить изменения' : 'Добавить запись'}
              </button>
            </div>
          </form>
        )}

        {/* Subscription Table/List */}
        {filteredSubscriptions.length === 0 ? (
          <div className="text-center py-10 bg-slate-50/50 rounded-xl border border-slate-200/80" id="empty-state">
            <AlertTriangle className="mx-auto text-slate-400 mb-2" size={32} />
            <p className="text-slate-500 text-sm">Не найдено регулярных платежей по выбранным фильтрам</p>
            <p className="text-slate-400 text-xs mt-1">Попробуйте сбросить фильтры или добавить новые подписки.</p>
          </div>
        ) : (
          <div className="overflow-x-auto" id="table-container">
            <table className="w-full text-left border-collapse" id="subscriptions-table">
              <thead>
                <tr className="border-b border-slate-200 text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
                  <th className="py-3 px-4">Услуга / Категория</th>
                  <th className="py-3 px-4">Стоимость</th>
                  <th className="py-3 px-4">Стоимость (RUB)</th>
                  <th className="py-3 px-4">Дата списания</th>
                  <th className="py-3 px-4">До списания</th>
                  <th className="py-3 px-4">Статус</th>
                  <th className="py-3 px-4 text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/60 text-xs text-slate-600">
                {filteredSubscriptions.map((sub) => {
                  const daysRemaining = getDaysRemaining(sub.next_payment_date);
                  const rubEquiv = convertToRub(sub.amount, sub.currency);

                  return (
                    <tr
                      key={sub.id}
                      className="hover:bg-slate-50/60 transition-colors group"
                      id={`row-${sub.id}`}
                    >
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{sub.title}</div>
                        <span className="inline-block mt-0.5 px-2 py-0.5 text-[9px] font-mono tracking-wider bg-slate-100 border border-slate-200 text-slate-600 rounded">
                          {CATEGORY_TRANSLATIONS[sub.category.toLowerCase()] || sub.category}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono font-medium text-slate-900">
                        {sub.amount.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} {sub.currency}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-500">
                        ≈ {rubEquiv.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽
                      </td>
                      <td className="py-3 px-4 text-slate-500">
                        {new Date(sub.next_payment_date).toLocaleDateString('ru-RU', {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="py-3 px-4">
                        {sub.status === 'inactive' ? (
                          <span className="text-slate-400">—</span>
                        ) : daysRemaining < 0 ? (
                          <span className="text-red-600 font-semibold">Просрочен ({Math.abs(daysRemaining)} дн)</span>
                        ) : daysRemaining === 0 ? (
                          <span className="text-amber-600 font-bold">Сегодня!</span>
                        ) : daysRemaining === 1 ? (
                          <span className="text-amber-700 font-medium">Завтра</span>
                        ) : daysRemaining <= 7 ? (
                          <span className="text-teal-600 font-medium">{daysRemaining} дн (эта неделя)</span>
                        ) : (
                          <span className="text-slate-500">{daysRemaining} дн</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {sub.status === 'active' ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                            <CheckCircle2 size={10} />
                            Активно
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">
                            <XCircle size={10} />
                            Неактивно
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => handleEditClick(sub)}
                            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded transition-all cursor-pointer"
                            title="Редактировать"
                            id={`btn-edit-${sub.id}`}
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            onClick={() => onDelete(sub.id)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-slate-100 rounded transition-all cursor-pointer"
                            title="Удалить"
                            id={`btn-delete-${sub.id}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
