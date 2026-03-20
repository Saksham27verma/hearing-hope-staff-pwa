import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loginWithPhonePassword } from '../auth';
import styles from './LoginScreen.module.css';

export default function LoginScreen() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleLogin = async () => {
    setErr(null);
    const trimmedPhone = phone.trim();
    const trimmedPassword = password.trim();

    if (!trimmedPhone || !trimmedPassword) {
      setErr('Please enter phone number and password');
      return;
    }

    if (!/^\d{10}$/.test(trimmedPhone.replace(/\D/g, '').slice(-10))) {
      setErr('Please enter a valid 10-digit phone number');
      return;
    }

    setLoading(true);
    try {
      const normalizedPhone = trimmedPhone.replace(/\D/g, '').slice(-10);
      await loginWithPhonePassword(normalizedPhone, trimmedPassword);
      navigate('/app', { replace: true });
    } catch (e: unknown) {
      setErr((e as Error)?.message || 'Invalid credentials. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <div className={styles.logo}>HH</div>
          <h1 className={styles.title}>Hearing Hope</h1>
          <p className={styles.subtitle}>Home Visit App</p>
        </header>

        <div className={styles.form}>
          <input
            className={styles.input}
            placeholder="Phone Number (10 digits)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
            maxLength={12}
            disabled={loading}
          />
          <input
            className={styles.input}
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            disabled={loading}
          />
          {err ? <p className={styles.err}>{err}</p> : null}
          <button type="button" className={styles.btn} onClick={handleLogin} disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </div>
      </div>
    </div>
  );
}
