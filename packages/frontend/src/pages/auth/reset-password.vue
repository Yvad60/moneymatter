<template>
  <div class="flex h-dvh items-center justify-center px-6">
    <Card v-if="isLinkInvalid" class="w-full max-w-112.5">
      <CardHeader class="text-center">
        <div class="bg-destructive/10 mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full">
          <TriangleAlertIcon class="text-destructive-text h-8 w-8" />
        </div>
        <h1 class="text-2xl font-semibold tracking-tight">{{ $t('auth.resetPassword.invalidTitle') }}</h1>
      </CardHeader>
      <CardContent class="text-center">
        <p class="text-muted-foreground">{{ $t('auth.resetPassword.invalidDescription') }}</p>
      </CardContent>
      <CardFooter class="flex-col gap-3">
        <router-link :to="{ name: ROUTES_NAMES.forgotPassword }" class="w-full">
          <Button as="span" class="w-full"> {{ $t('auth.resetPassword.requestNewLink') }} </Button>
        </router-link>
        <router-link :to="{ name: ROUTES_NAMES.signIn }" class="w-full">
          <Button as="span" variant="outline" class="w-full"> {{ $t('auth.resetPassword.backToSignIn') }} </Button>
        </router-link>
      </CardFooter>
    </Card>

    <Card v-else class="w-full max-w-112.5" as="form" @submit.prevent="submit()">
      <CardHeader>
        <h1 class="text-center text-2xl font-semibold tracking-tight">{{ $t('auth.resetPassword.title') }}</h1>
      </CardHeader>
      <CardContent class="grid gap-5">
        <form-wrapper :error="formError" class="grid gap-5">
          <input-field
            v-model="form.newPassword"
            :label="$t('auth.resetPassword.newPasswordLabel')"
            :placeholder="$t('auth.resetPassword.newPasswordPlaceholder')"
            type="password"
            :disabled="isLoading"
            :error-message="getFieldErrorMessage('form.newPassword')"
          />
          <input-field
            v-model="form.confirmPassword"
            :label="$t('auth.resetPassword.confirmPasswordLabel')"
            :placeholder="$t('auth.resetPassword.confirmPasswordPlaceholder')"
            type="password"
            :disabled="isLoading"
            :error-message="getFieldErrorMessage('form.confirmPassword')"
          />
        </form-wrapper>

        <Button type="submit" :disabled="isLoading" class="w-full">
          {{ isLoading ? $t('common.actions.loading') : $t('auth.resetPassword.submitButton') }}
        </Button>
      </CardContent>
    </Card>
  </div>
</template>

<script lang="ts" setup>
import InputField from '@/components/fields/input-field.vue';
import FormWrapper from '@/components/fields/form-wrapper.vue';
import { Button } from '@/components/lib/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/lib/ui/card';
import { useNotificationCenter } from '@/components/notification-center';
import { useFormValidation } from '@/composable';
import { maxLength, minLength, required, sameAs } from '@/js/helpers/validators';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@bt/shared/const/auth';
import { authClient } from '@/lib/auth-client';
import { RESET_PASSWORD_TOKEN_STORAGE_KEY } from '@/lib/reset-password-token';
import { captureException } from '@/lib/sentry';
import { ROUTES_NAMES } from '@/routes/constants';
import { useAuthStore } from '@/stores';
import { TriangleAlertIcon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

const INVALID_TOKEN_CODE = 'INVALID_TOKEN';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const { addSuccessNotification } = useNotificationCenter();
const authStore = useAuthStore();

const passwordTooShortMessage = t('validation.minLength', { length: PASSWORD_MIN_LENGTH });
const passwordTooLongMessage = t('auth.resetPassword.errors.passwordTooLong', { length: PASSWORD_MAX_LENGTH });
const ERROR_MESSAGES: Record<string, string> = {
  PASSWORD_TOO_SHORT: passwordTooShortMessage,
  PASSWORD_TOO_LONG: passwordTooLongMessage,
};

const token = sessionStorage.getItem(RESET_PASSWORD_TOKEN_STORAGE_KEY) ?? '';
const isLinkInvalid = ref(false);

const invalidateLink = () => {
  sessionStorage.removeItem(RESET_PASSWORD_TOKEN_STORAGE_KEY);
  isLinkInvalid.value = true;
};

if (!token || route.query.error === INVALID_TOKEN_CODE) invalidateLink();

const form = ref({ newPassword: '', confirmPassword: '' });
const isLoading = ref(false);
const formError = ref<string | null>(null);

const { isFormValid, getFieldErrorMessage } = useFormValidation(
  { form },
  {
    form: {
      newPassword: {
        required,
        minLength: minLength(PASSWORD_MIN_LENGTH),
        maxLength: maxLength(PASSWORD_MAX_LENGTH),
      },
      confirmPassword: { required, sameAsPassword: sameAs(computed(() => form.value.newPassword)) },
    },
  },
  undefined,
  {
    customValidationMessages: {
      minLength: passwordTooShortMessage,
      maxLength: passwordTooLongMessage,
      sameAsPassword: t('validation.passwordsNoMatch'),
    },
  },
);

watch(form.value, () => {
  formError.value = null;
});

const resetPassword = async (): Promise<boolean> => {
  try {
    const { error } = await authClient.resetPassword({ newPassword: form.value.newPassword, token });
    if (!error) return true;

    if (error.code === INVALID_TOKEN_CODE) {
      invalidateLink();
    } else {
      formError.value = (error.code && ERROR_MESSAGES[error.code]) || t('auth.resetPassword.genericError');
    }
  } catch (error) {
    captureException({ error, context: { scope: 'auth:reset-password' } });
    formError.value = t('auth.resetPassword.genericError');
  }
  return false;
};

const submit = async () => {
  if (isLoading.value || !isFormValid()) return;

  isLoading.value = true;

  if (await resetPassword()) {
    sessionStorage.removeItem(RESET_PASSWORD_TOKEN_STORAGE_KEY);
    // The server revoked every session; the page is unguarded, so isLoggedIn can't be trusted here.
    await authStore
      .logout()
      .catch((error) => captureException({ error, context: { scope: 'auth:reset-password-logout' } }));
    addSuccessNotification(t('auth.resetPassword.success'));
    router.replace({ name: ROUTES_NAMES.signIn });
  }

  isLoading.value = false;
};
</script>
