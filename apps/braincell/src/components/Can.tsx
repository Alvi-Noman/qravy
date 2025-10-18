import React from 'react';
import { usePermissions } from '../context/PermissionsContext';

type Props = {
  capability?: string;
  anyOf?: string[];
  allOf?: string[];
  not?: boolean;
  fallback?: React.ReactNode;
  children: React.ReactNode | ((allowed: boolean) => React.ReactNode);
};

export default function Can({ capability, anyOf, allOf, not = false, fallback = null, children }: Props) {
  const { has, any, all } = usePermissions();

  const tests: boolean[] = [];
  if (capability) tests.push(has(capability));
  if (anyOf && anyOf.length) tests.push(any(anyOf));
  if (allOf && allOf.length) tests.push(all(allOf));

  // If no tests specified, default to false
  const allowedBase = tests.length ? tests.every(Boolean) : false;
  const allowed = not ? !allowedBase : allowedBase;

  if (typeof children === 'function') {
    return <>{children(allowed)}</>;
  }

  return <>{allowed ? children : fallback}</>;
}