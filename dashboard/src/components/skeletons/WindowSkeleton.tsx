import styles from './WindowSkeleton.module.css';

export interface WindowSkeletonProps {
  type?: 'terminal' | 'docker' | 'files' | 'metrics' | 'settings' | string;
}

export default function WindowSkeleton({ type = 'default' }: WindowSkeletonProps) {
  if (type === 'terminal' || type === 'docker-console') {
    return (
      <div className={styles.terminalContainer} role="status" aria-label="Loading terminal">
        <div className={styles.terminalTopBar}>
          <div className={styles.shimmer} style={{ width: '120px', height: '14px' }} />
          <div style={{ display: 'flex', gap: '8px' }}>
            <div className={styles.shimmer} style={{ width: '20px', height: '20px', borderRadius: '4px' }} />
            <div className={styles.shimmer} style={{ width: '20px', height: '20px', borderRadius: '4px' }} />
          </div>
        </div>
        <div className={styles.terminalBody}>
          <div className={`${styles.shimmer} ${styles.terminalLine}`} style={{ width: '45%' }} />
          <div className={`${styles.shimmer} ${styles.terminalLine}`} style={{ width: '70%' }} />
          <div className={`${styles.shimmer} ${styles.terminalLine}`} style={{ width: '35%' }} />
          <div className={`${styles.shimmer} ${styles.terminalLine}`} style={{ width: '85%' }} />
          <div className={`${styles.shimmer} ${styles.terminalLine}`} style={{ width: '60%' }} />
          <div className={`${styles.shimmer} ${styles.terminalLine}`} style={{ width: '20%' }} />
        </div>
      </div>
    );
  }

  if (type === 'docker') {
    return (
      <div className={styles.dockerContainer} role="status" aria-label="Loading docker manager">
        <div className={styles.dockerSidebar}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className={styles.dockerNavItem}>
              <div className={styles.shimmer} style={{ width: '16px', height: '16px', borderRadius: '4px' }} />
              <div className={styles.shimmer} style={{ width: `${60 + (i % 3) * 15}%`, height: '12px' }} />
            </div>
          ))}
        </div>
        <div className={styles.dockerMain}>
          <div className={styles.dockerToolbar}>
            <div className={styles.shimmer} style={{ width: '220px', height: '32px', borderRadius: '6px' }} />
            <div style={{ display: 'flex', gap: '8px' }}>
              <div className={styles.shimmer} style={{ width: '80px', height: '32px', borderRadius: '6px' }} />
              <div className={styles.shimmer} style={{ width: '90px', height: '32px', borderRadius: '6px' }} />
            </div>
          </div>
          <div className={styles.dockerRows}>
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className={styles.dockerRow}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div className={styles.shimmer} style={{ width: '24px', height: '24px', borderRadius: '4px' }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div className={styles.shimmer} style={{ width: `${140 + (i % 3) * 30}px`, height: '14px' }} />
                    <div className={styles.shimmer} style={{ width: '100px', height: '10px' }} />
                  </div>
                </div>
                <div className={styles.shimmer} style={{ width: '70px', height: '22px', borderRadius: '12px' }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (type === 'files') {
    return (
      <div className={styles.filesContainer} role="status" aria-label="Loading file explorer">
        <div className={styles.filesTopBar}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <div className={styles.shimmer} style={{ width: '24px', height: '24px', borderRadius: '4px' }} />
            <div className={styles.shimmer} style={{ width: '160px', height: '16px' }} />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <div className={styles.shimmer} style={{ width: '28px', height: '28px', borderRadius: '4px' }} />
            <div className={styles.shimmer} style={{ width: '28px', height: '28px', borderRadius: '4px' }} />
          </div>
        </div>
        <div className={styles.filesTable}>
          <div className={styles.filesTableRow} style={{ borderBottom: '1px solid var(--border-subtle, #262626)' }}>
            <div className={styles.shimmer} style={{ width: '40%', height: '12px' }} />
            <div className={styles.shimmer} style={{ width: '20%', height: '12px' }} />
            <div className={styles.shimmer} style={{ width: '30%', height: '12px' }} />
          </div>
          {[1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className={styles.filesTableRow}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '40%' }}>
                <div className={styles.shimmer} style={{ width: '16px', height: '16px', borderRadius: '3px' }} />
                <div className={styles.shimmer} style={{ width: `${50 + (i % 4) * 12}%`, height: '13px' }} />
              </div>
              <div className={styles.shimmer} style={{ width: '20%', height: '12px' }} />
              <div className={styles.shimmer} style={{ width: '30%', height: '12px' }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (type === 'settings') {
    return (
      <div className={styles.dockerContainer} role="status" aria-label="Loading settings">
        <div className={styles.dockerSidebar}>
          <div className={styles.dockerNavItem}>
            <div className={styles.shimmer} style={{ width: '16px', height: '16px', borderRadius: '4px' }} />
            <div className={styles.shimmer} style={{ width: '72%', height: '12px' }} />
          </div>
        </div>
        <div className={styles.dockerMain}>
          <div className={styles.shimmer} style={{ width: '140px', height: '22px' }} />
          <div className={styles.shimmer} style={{ width: '100%', height: '140px', borderRadius: '10px' }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className={styles.shimmer} style={{ aspectRatio: '16 / 9', borderRadius: '8px' }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (type === 'metrics') {
    return (
      <div className={styles.metricsContainer} role="status" aria-label="Loading activity monitor">
        <div className={styles.metricsTopBar}>
          <div className={styles.shimmer} style={{ width: '140px', height: '16px' }} />
        </div>
        <div className={styles.metricsGrid}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className={styles.metricCard}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div className={styles.shimmer} style={{ width: '50px', height: '12px' }} />
                <div className={styles.shimmer} style={{ width: '16px', height: '16px', borderRadius: '4px' }} />
              </div>
              <div className={styles.shimmer} style={{ width: '70px', height: '24px' }} />
              <div className={styles.shimmer} style={{ width: '100%', height: '4px', borderRadius: '2px' }} />
            </div>
          ))}
        </div>
        <div className={styles.metricsChartArea}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className={styles.shimmer} style={{ width: '120px', height: '14px' }} />
            <div className={styles.shimmer} style={{ width: '80px', height: '12px' }} />
          </div>
          <div className={styles.shimmer} style={{ flex: 1, minHeight: '140px', borderRadius: '6px' }} />
        </div>
      </div>
    );
  }

  // Default fallback
  return (
    <div className={styles.defaultContainer} role="status" aria-label="Loading content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className={styles.shimmer} style={{ width: '160px', height: '20px' }} />
        <div className={styles.shimmer} style={{ width: '80px', height: '28px', borderRadius: '6px' }} />
      </div>
      <div className={styles.shimmer} style={{ width: '100%', height: '1px' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
        <div className={styles.shimmer} style={{ width: '100%', height: '48px', borderRadius: '6px' }} />
        <div className={styles.shimmer} style={{ width: '100%', height: '48px', borderRadius: '6px' }} />
        <div className={styles.shimmer} style={{ width: '100%', height: '48px', borderRadius: '6px' }} />
        <div className={styles.shimmer} style={{ width: '100%', height: '48px', borderRadius: '6px' }} />
      </div>
    </div>
  );
}
