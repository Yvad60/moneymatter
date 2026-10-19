import { bankProviderRegistry } from '@services/bank-data-providers';

import { isProviderAvailableForUser } from './provider-availability';

export const listSupportedProviders = async ({ userId }: { userId: number }) => {
  const providers = bankProviderRegistry.listAll();
  const availability = await Promise.all(
    providers.map((provider) => isProviderAvailableForUser({ userId, providerType: provider.type })),
  );

  return providers.filter((_, index) => availability[index]);
};
