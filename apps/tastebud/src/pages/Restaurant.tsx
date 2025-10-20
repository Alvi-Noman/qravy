import React from 'react';
import { useLocation, useParams, useSearchParams, Link, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import type { v1 } from '../../../../packages/shared/src/types';

type Channel = 'online' | 'dine-in';

const baseURL =
  (typeof window !== 'undefined' && window.__STORE__?.apiBase) || '/api/v1';

function resolveChannelFromPath(pathname: string): Channel {
  return pathname.toLowerCase().startsWith('/dine-in') ||
    pathname.toLowerCase().includes('/dine-in')
    ? 'dine-in'
    : 'online';
}

function useRuntimeRoute() {
  const { subdomain, branchSlug } = useParams<{
    subdomain?: string;
    branchSlug?: string;
  }>();
  const location = useLocation();
  const [search] = useSearchParams();

  // Priority: route params → query string → injected runtime → null
  const sd =
    subdomain ??
    search.get('subdomain') ??
    (typeof window !== 'undefined' ? window.__STORE__?.subdomain ?? null : null);

  const branch =
    branchSlug ??
    search.get('branch') ??
    (typeof window !== 'undefined' ? window.__STORE__?.branch ?? null : null);

  const channelFromPath = resolveChannelFromPath(location.pathname);
  const ch =
    (search.get('channel') as Channel | null) ??
    (typeof window !== 'undefined' ? (window.__STORE__?.channel as Channel | null) ?? null : null) ??
    channelFromPath;

  return {
    subdomain: sd,
    branchSlug: branch,
    channel: ch as Channel,
  };
}

async function fetchPublicMenu(params: {
  subdomain: string;
  branch?: string | null;
  channel: Channel;
}): Promise<v1.MenuItemDTO[]> {
  const { data } = await axios.get(`${baseURL}/public/menu`, {
    withCredentials: true,
    params: {
      subdomain: params.subdomain,
      branch: params.branch ?? undefined,
      channel: params.channel,
    },
  });
  return data.items as v1.MenuItemDTO[];
}

export default function RestaurantPage() {
  const { subdomain, branchSlug, channel } = useRuntimeRoute();

  // If we have no subdomain at all, gently send user to a demo route (or your home).
  if (!subdomain) {
    return <Navigate to="/t/demo" replace />;
  }

  const queryKey = ['publicMenu', { subdomain, branchSlug, channel }];
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey,
    queryFn: () => fetchPublicMenu({ subdomain, branch: branchSlug, channel }),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {subdomain}
            {branchSlug ? <span className="text-gray-500"> · {branchSlug}</span> : null}
          </h1>
          <p className="text-sm text-gray-500">
            Channel:{' '}
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium">
              {channel}
            </span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Channel toggle as links to keep URL the source of truth */}
          <Link
            to={
              branchSlug
                ? `/t/${subdomain}/branch/${branchSlug}`
                : `/t/${subdomain}`
            }
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset ${
              channel === 'online'
                ? 'bg-black text-white ring-black'
                : 'bg-white text-gray-700 ring-gray-300 hover:bg-gray-50'
            }`}
          >
            Online
          </Link>
          <Link
            to={
              branchSlug
                ? `/t/${subdomain}/branch/${branchSlug}/dine-in`
                : `/t/${subdomain}/dine-in`
            }
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset ${
              channel === 'dine-in'
                ? 'bg-black text-white ring-black'
                : 'bg-white text-gray-700 ring-gray-300 hover:bg-gray-50'
            }`}
          >
            Dine-in
          </Link>

          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-50"
          >
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-xl bg-gray-100" />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Failed to load menu. {(error as Error)?.message ?? 'Unknown error'}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {(data ?? []).map((item) => (
            <article
              key={item.id}
              className="group flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white"
            >
              {item.media?.[0] ? (
                <img
                  src={item.media[0]}
                  alt={item.name}
                  loading="lazy"
                  className="aspect-[4/3] w-full object-cover transition-transform group-hover:scale-[1.02]"
                />
              ) : (
                <div className="aspect-[4/3] w-full bg-gray-100" />
              )}
              <div className="flex flex-1 flex-col p-3">
                <h3 className="line-clamp-2 text-sm font-medium">{item.name}</h3>
                {typeof item.price === 'number' ? (
                  <p className="mt-1 text-sm text-gray-700">${item.price.toFixed(2)}</p>
                ) : item.variations?.length ? (
                  <p className="mt-1 text-sm text-gray-700">
                    from $
                    {Math.min(
                      ...item.variations
                        .map((v) => (typeof v.price === 'number' ? v.price : Number.POSITIVE_INFINITY))
                        .filter((n) => Number.isFinite(n))
                    ).toFixed(2)}
                  </p>
                ) : (
                  <div className="mt-1 h-4" />
                )}
                {item.status === 'hidden' && (
                  <span className="mt-2 w-fit rounded-full bg-yellow-50 px-2 py-0.5 text-xs font-medium text-yellow-700 ring-1 ring-yellow-200">
                    Unavailable
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
