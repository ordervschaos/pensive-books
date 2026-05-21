import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useCookieConsent } from '@/hooks/useCookieConsent';

declare global {
  interface Window {
    dataLayer: any[];
    gtag: (...args: any[]) => void;
  }
}

export const GA_TRACKING_ID = 'G-FGXKSH2GWE';

export const useGoogleAnalytics = () => {
  const location = useLocation();
  const { consent } = useCookieConsent();

  useEffect(() => {
    if (consent !== 'accepted') return;

    const script1 = document.createElement('script');
    script1.async = true;
    script1.src = `https://www.googletagmanager.com/gtag/js?id=${GA_TRACKING_ID}`;

    const script2 = document.createElement('script');
    script2.innerHTML = `
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', '${GA_TRACKING_ID}');
    `;

    document.head.appendChild(script1);
    document.head.appendChild(script2);

    return () => {
      script1.remove();
      script2.remove();
    };
  }, [consent]);

  useEffect(() => {
    if (consent !== 'accepted' || !window.gtag) return;
    window.gtag('event', 'page_view', {
      page_path: location.pathname + location.search,
    });
  }, [location, consent]);
};
