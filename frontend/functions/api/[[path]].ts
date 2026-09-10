const BACKEND_URL = 'https://red-crescent-minya-production.red-crescent-minya.workers.dev';

export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  const backendUrl = new URL(url.pathname + url.search, BACKEND_URL);

  const modifiedRequest = new Request(backendUrl, {
    method: context.request.method,
    headers: context.request.headers,
    body: context.request.body,
    redirect: 'follow',
  });

  // Remove host header that would confuse the backend
  modifiedRequest.headers.delete('host');

  return fetch(modifiedRequest);
};
