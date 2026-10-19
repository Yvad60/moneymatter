import type { CombinedBalanceHistoryEntity } from '@/api/stats';
import { computeAccountDisplayBalances } from '@/common/utils/account-balance';
import { type AccountModel, type ResourceShareInfo } from '@bt/shared/types';

import { isCashAccount } from '../cash-accounts-widget/helpers';

export type BucketKey = 'investments' | 'cash' | 'vehicles' | 'ventures' | 'loans' | 'creditAndOverdrafts';

export interface Bucket {
  key: BucketKey;
  amount: number;
}

type CreditDebtAccount = Pick<
  AccountModel,
  'excludeFromStats' | 'accountCategory' | 'currentBalance' | 'refCurrentBalance' | 'creditLimit' | 'refCreditLimit'
> & { share?: Pick<ResourceShareInfo, 'isOwner'> };

const positiveDesc = ({ buckets }: { buckets: Bucket[] }): Bucket[] =>
  buckets.filter((bucket) => bucket.amount > 0).sort((a, b) => b.amount - a.amount);

const sumBuckets = ({ buckets }: { buckets: Bucket[] }): number =>
  buckets.reduce((total, bucket) => total + bucket.amount, 0);

/**
 * `accountsBalance` nets negative account balances against positive ones, so the debt part is
 * taken from the same accounts the server sums and moved into liabilities, leaving net worth unchanged.
 */
export const computeAssetsLiabilities = ({
  point,
  accounts,
  includeCreditLimit,
}: {
  point: Pick<
    CombinedBalanceHistoryEntity,
    'accountsBalance' | 'portfoliosBalance' | 'venturesBalance' | 'vehiclesBalance' | 'loansBalance'
  >;
  accounts: CreditDebtAccount[];
  includeCreditLimit: boolean;
}) => {
  const creditDebt = accounts.reduce((total, account) => {
    if ((account.share && !account.share.isOwner) || !isCashAccount({ account })) return total;

    const { displayRefBalance } = computeAccountDisplayBalances({
      currentBalance: account.currentBalance,
      refCurrentBalance: account.refCurrentBalance,
      creditLimit: account.creditLimit,
      refCreditLimit: account.refCreditLimit,
      includeCreditLimit,
    });
    return displayRefBalance < 0 ? total - displayRefBalance : total;
  }, 0);

  const assets = positiveDesc({
    buckets: [
      { key: 'investments', amount: point.portfoliosBalance },
      { key: 'cash', amount: point.accountsBalance + creditDebt },
      { key: 'vehicles', amount: point.vehiclesBalance },
      { key: 'ventures', amount: point.venturesBalance },
    ],
  });
  const liabilities = positiveDesc({
    buckets: [
      { key: 'loans', amount: -point.loansBalance },
      { key: 'creditAndOverdrafts', amount: creditDebt },
    ],
  });
  const assetsTotal = sumBuckets({ buckets: assets });
  const liabilitiesTotal = sumBuckets({ buckets: liabilities });

  return { assets, liabilities, assetsTotal, liabilitiesTotal, netWorth: assetsTotal - liabilitiesTotal };
};

export const formatShareLabel = ({ part, total }: { part: number; total: number }): string => {
  const percent = (part / total) * 100;
  return percent > 0 && percent < 1 ? '<1%' : `${Math.round(percent)}%`;
};
