import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  IoTimeOutline,
  IoLocationOutline,
  IoBusinessOutline,
  IoCall,
  IoNavigate,
  IoCloudOfflineOutline,
  IoCalendarOutline,
} from 'react-icons/io5';
import { useAppointmentsContext } from '../context/AppointmentsContext';
import type { Appointment } from '../types';
import { theme } from '../theme';
import { parseStartToDate, getStartForDisplay, isAppointmentToday, formatTime } from '../dateUtils';
import styles from './AppointmentsScreen.module.css';

type TabFilter = 'all' | 'today' | 'upcoming' | 'completed' | 'cancelled';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

function getStatusStyle(status?: string) {
  const s = (status || '').toLowerCase();
  if (s === 'completed')
    return { bg: theme.colors.successBg, text: theme.colors.successText, dot: theme.colors.success };
  if (s === 'cancelled')
    return { bg: theme.colors.errorBg, text: theme.colors.errorText, dot: theme.colors.error };
  return { bg: theme.colors.scheduledBg, text: theme.colors.scheduledText, dot: theme.colors.scheduled };
}

interface GroupedSection {
  key: string;
  label: string;
  appointments: Appointment[];
}

function getDateLabel(start: unknown): string {
  const d = parseStartToDate(start);
  return d ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

function groupByDate(appointments: Appointment[]): GroupedSection[] {
  const byDate = new Map<string, Appointment[]>();
  for (const apt of appointments) {
    const label = getDateLabel(apt.start);
    if (!label) continue;
    const list = byDate.get(label) || [];
    list.push(apt);
    byDate.set(label, list);
  }
  const sorted = [...byDate.entries()].sort((a, b) => {
    const d1 = parseStartToDate(a[1][0]?.start);
    const d2 = parseStartToDate(b[1][0]?.start);
    if (!d1 || !d2) return 0;
    return d1.getTime() - d2.getTime();
  });
  return sorted.map(([label, apts]) => {
    apts.sort((a, b) => getStartForDisplay(a.start).localeCompare(getStartForDisplay(b.start)));
    return { key: label, label, appointments: apts };
  });
}

interface Props {
  onLogout: () => void;
}

export default function AppointmentsScreen({ onLogout }: Props) {
  const navigate = useNavigate();
  const { appointments, loading, error, isOnline, refresh } = useAppointmentsContext();
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabFilter>('today');

  const filtered = useMemo(() => {
    const now = new Date();
    switch (activeTab) {
      case 'today':
        return appointments.filter((a) => isAppointmentToday(a.start));
      case 'upcoming':
        return appointments.filter((a) => {
          const d = parseStartToDate(a.start);
          return d && d > now && ((a.status || '').toLowerCase() === 'scheduled' || !a.status);
        });
      case 'completed':
        return appointments.filter((a) => (a.status || '').toLowerCase() === 'completed');
      case 'cancelled':
        return appointments.filter((a) => (a.status || '').toLowerCase() === 'cancelled');
      default:
        return appointments;
    }
  }, [appointments, activeTab]);

  const grouped = useMemo(() => {
    if (activeTab === 'today') {
      const sorted = [...filtered].sort((a, b) =>
        getStartForDisplay(a.start).localeCompare(getStartForDisplay(b.start))
      );
      return sorted.length > 0 ? [{ key: 'today', label: 'Today', appointments: sorted }] : [];
    }
    return groupByDate(filtered);
  }, [filtered, activeTab]);

  const todayAppointments = useMemo(
    () => appointments.filter((a) => isAppointmentToday(a.start)),
    [appointments]
  );
  const completedToday = useMemo(
    () => todayAppointments.filter((a) => (a.status || '').toLowerCase() === 'completed').length,
    [todayAppointments]
  );
  const totalToday = useMemo(
    () => todayAppointments.filter((a) => (a.status || '').toLowerCase() !== 'cancelled').length,
    [todayAppointments]
  );
  const progress = totalToday > 0 ? completedToday / totalToday : 0;

  const tabs: { key: TabFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'today', label: 'Today' },
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'completed', label: 'Completed' },
    { key: 'cancelled', label: 'Cancelled' },
  ];

  const onRefresh = async () => {
    setRefreshing(true);
    refresh();
    await new Promise((r) => setTimeout(r, 800));
    setRefreshing(false);
  };

  const isIndexError = error?.toLowerCase().includes('index') || error?.toLowerCase().includes('create_composite');
  const indexUrl = error?.match(/https:\/\/[^\s]+/)?.[0] || '';

  const handleCall = (e: React.MouseEvent, item: Appointment) => {
    e.stopPropagation();
    const phone = item.patientPhone?.replace(/\D/g, '') || '';
    if (phone) window.open(`tel:${phone}`, '_self');
  };

  const handleMap = (e: React.MouseEvent, item: Appointment) => {
    e.stopPropagation();
    if (item.address) window.open(`https://maps.google.com/?q=${encodeURIComponent(item.address)}`, '_blank');
  };

  const renderCard = (item: Appointment) => {
    const st = getStatusStyle(item.status);
    const isHomeVisit = item.type === 'home';
    const isCenterVisit = item.type === 'center';
    const centerLabel = item.centerName || item.centerId || 'Center';
    const startIso = getStartForDisplay(item.start);

    return (
      <button
        type="button"
        key={item.id}
        className={styles.card}
        onClick={() => navigate(`/app/visit/${encodeURIComponent(item.id)}`)}
      >
        <div className={styles.cardHeader}>
          <div className={styles.cardTitleRow}>
            <span className={styles.cardName}>{item.patientName || item.title || 'Patient'}</span>
            <span className={`${styles.visitBadge} ${isHomeVisit ? styles.visitHome : styles.visitCenter}`}>
              {isHomeVisit ? (
                <>
                  <span aria-hidden>⌂</span> Home
                </>
              ) : (
                <>
                  <span aria-hidden>▢</span> Center
                </>
              )}
            </span>
          </div>
          <span className={styles.statusBadge} style={{ backgroundColor: st.bg, color: st.text }}>
            <span className={styles.statusDot} style={{ backgroundColor: st.dot }} />
            {item.status || 'scheduled'}
          </span>
        </div>

        <div className={styles.cardMeta}>
          <div className={styles.metaRow}>
            <IoTimeOutline className={styles.metaIcon} size={14} />
            <span className={styles.cardMetaText}>{formatTime(startIso)}</span>
          </div>
          {isHomeVisit && item.address ? (
            <div className={styles.metaRow}>
              <IoLocationOutline className={styles.metaIcon} size={14} />
              <span className={styles.cardMetaText}>{item.address}</span>
            </div>
          ) : null}
          {isCenterVisit ? (
            <div className={styles.metaRow}>
              <IoBusinessOutline className={styles.metaIcon} size={14} />
              <span className={styles.cardMetaText}>{centerLabel}</span>
            </div>
          ) : null}
        </div>

        <div className={styles.quickActions}>
          <button
            type="button"
            className={styles.qaBtn}
            disabled={!item.patientPhone}
            onClick={(e) => handleCall(e, item)}
            aria-label="Call patient"
          >
            <IoCall size={18} />
          </button>
          {isHomeVisit ? (
            <button
              type="button"
              className={styles.qaBtn}
              disabled={!item.address}
              onClick={(e) => handleMap(e, item)}
              aria-label="Open maps"
            >
              <IoNavigate size={18} />
            </button>
          ) : null}
        </div>
      </button>
    );
  };

  return (
    <div className={styles.container}>
      <header className={styles.headerBar}>
        <div className={styles.header}>
          <div>
            <p className={styles.greeting}>{getGreeting()}</p>
            <h1 className={styles.title}>My Appointments</h1>
          </div>
          <div className={styles.headerRight}>
            {!isOnline ? (
              <span className={styles.offlineBadge}>
                <IoCloudOfflineOutline size={16} />
                Offline
              </span>
            ) : null}
            <button type="button" className={styles.logoutBtn} onClick={onLogout}>
              Logout
            </button>
          </div>
        </div>

        {totalToday > 0 ? (
          <div className={styles.progressSection}>
            <div className={styles.progressHeader}>
              <span className={styles.progressLabel}>Daily Progress</span>
              <span className={styles.progressCount}>
                {completedToday} of {totalToday} completed
              </span>
            </div>
            <div className={styles.progressTrack}>
              <div className={styles.progressFill} style={{ width: `${progress * 100}%` }} />
            </div>
          </div>
        ) : null}

        <div className={styles.segmented}>
          <div className={styles.tabsScroll} role="tablist">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.key}
                className={`${styles.tab} ${activeTab === tab.key ? styles.tabActive : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {error ? (
        <div className={styles.centered}>
          <p className={styles.errorTitle}>Something went wrong</p>
          <p className={styles.errorText}>
            {isIndexError
              ? 'The database is still setting up. Please wait a minute and pull down to refresh.'
              : 'Please check your connection and try again.'}
          </p>
          {isIndexError && indexUrl ? (
            <button type="button" className={styles.indexLink} onClick={() => window.open(indexUrl, '_blank')}>
              Create index (if needed)
            </button>
          ) : null}
        </div>
      ) : loading && appointments.length === 0 ? (
        <div className={styles.centered}>
          <div className={styles.spinner} />
        </div>
      ) : filtered.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>
            <IoCalendarOutline size={48} />
          </div>
          <p className={styles.emptyTitle}>No appointments</p>
          <p className={styles.emptyText}>
            {activeTab === 'all'
              ? "You don't have any home visit appointments yet."
              : `No ${activeTab} appointments.`}
          </p>
        </div>
      ) : (
        <div
          className={styles.list}
          onTouchStart={() => {}}
          style={{ touchAction: 'pan-y' }}
        >
          {/* pull-to-refresh: simplified as button for web */}
          <div style={{ textAlign: 'center', marginBottom: 8 }}>
            <button
              type="button"
              className={styles.logoutBtn}
              onClick={onRefresh}
              disabled={refreshing}
              style={{ color: theme.colors.textSecondary }}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          {grouped.map((section) => (
            <section key={section.key} className={styles.section}>
              <h2 className={styles.sectionTitle}>{section.label}</h2>
              {section.appointments.map((apt) => (
                <div key={apt.id} className={styles.cardWrap}>
                  {renderCard(apt)}
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
