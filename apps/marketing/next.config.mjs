/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      // /library/book/:slug → /library/books/:slug
      {
        source: "/library/book/:slug*",
        destination: "/library/books/:slug*",
        permanent: true,
      },
      // /library/books/:book/page/:page → /library/books/:book/pages/:page
      {
        source: "/library/books/:bookSlug/page/:pageSlug*",
        destination: "/library/books/:bookSlug/pages/:pageSlug*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
