import { useUserSettings } from '@/composable/data-queries/user-settings';
import { useDebounceFn } from '@vueuse/core';
import { computed, ref, watch } from 'vue';

import {
  COLUMN_DEFINITIONS_BY_ID,
  type ColumnDefinition,
  DEFAULT_COLUMN_ORDER,
  DEFAULT_VISIBLE_COLUMNS,
  TABLE_COLUMN,
  clampColumnWidth,
  isKnownColumnId,
} from './columns';

const PERSIST_DEBOUNCE_MS = 1_000;

type PersistedField = 'visibleColumns' | 'columnOrder' | 'columnWidths';

/**
 * Column visibility, order and widths for the transactions table, persisted in
 * UserSettings under `ui.transactionsTable`. Unknown ids from settings are
 * dropped on read (a removed column must not break the table); known columns
 * missing from a stored order are appended in registry order so newly shipped
 * columns appear for existing users.
 */
export function useTableColumns() {
  const { data: userSettings, patch: patchSettings } = useUserSettings();

  const localOrder = ref<TABLE_COLUMN[]>([...DEFAULT_COLUMN_ORDER]);
  const localVisible = ref<TABLE_COLUMN[]>([...DEFAULT_VISIBLE_COLUMNS]);
  const localWidths = ref<Partial<Record<TABLE_COLUMN, number>>>({});
  // Fields edited locally but not yet sent. Hydration skips them so a settings
  // refresh can't undo a pending edit, and the PATCH carries only these, so an
  // edit made before settings load can't overwrite the other stored fields.
  const dirtyFields = new Set<PersistedField>();

  const sanitizeOrder = (storedOrder: string[]): TABLE_COLUMN[] => {
    const known = storedOrder.filter(isKnownColumnId);
    const missing = DEFAULT_COLUMN_ORDER.filter((id) => !known.includes(id));
    return [...known, ...missing];
  };

  watch(
    () => userSettings.value?.ui?.transactionsTable,
    (stored) => {
      if (!stored) return;
      if (!dirtyFields.has('columnOrder')) localOrder.value = sanitizeOrder(stored.columnOrder);
      const visible = stored.visibleColumns.filter(isKnownColumnId);
      if (!dirtyFields.has('visibleColumns') && visible.length > 0) localVisible.value = visible;
      if (!dirtyFields.has('columnWidths')) {
        localWidths.value = Object.fromEntries(
          (stored.columnWidths ?? [])
            .filter(({ id }) => isKnownColumnId(id))
            .map(({ id, widthPx }) => [id, clampColumnWidth({ widthPx })]),
        );
      }
    },
    { immediate: true },
  );

  const persistDebounced = useDebounceFn(() => {
    patchSettings({
      ui: {
        transactionsTable: {
          ...(dirtyFields.has('visibleColumns') && { visibleColumns: localVisible.value }),
          ...(dirtyFields.has('columnOrder') && { columnOrder: localOrder.value }),
          ...(dirtyFields.has('columnWidths') && {
            columnWidths: Object.entries(localWidths.value).map(([id, widthPx]) => ({ id, widthPx })),
          }),
        },
      },
    });
    dirtyFields.clear();
  }, PERSIST_DEBOUNCE_MS);

  const markEditedAndPersist = ({ fields }: { fields: PersistedField[] }) => {
    fields.forEach((field) => dirtyFields.add(field));
    persistDebounced();
  };

  /** Columns to render, in user order, with user-resized widths applied. */
  const visibleColumns = computed<ColumnDefinition[]>(() =>
    localOrder.value
      .filter((id) => localVisible.value.includes(id))
      .map((id) => {
        const customWidthPx = localWidths.value[id];
        const definition = COLUMN_DEFINITIONS_BY_ID[id];
        return customWidthPx ? { ...definition, widthPx: customWidthPx, isResized: true } : definition;
      }),
  );

  /** All columns in user order, with visibility flag — for the config panel. */
  const configurableColumns = computed(() =>
    localOrder.value.map((id) => ({
      definition: COLUMN_DEFINITIONS_BY_ID[id],
      visible: localVisible.value.includes(id),
    })),
  );

  const toggleColumn = (id: string) => {
    if (!isKnownColumnId(id)) return;
    if (localVisible.value.includes(id)) {
      // Keep at least one column visible — an empty table is a dead end.
      if (localVisible.value.length === 1) return;
      localVisible.value = localVisible.value.filter((columnId) => columnId !== id);
    } else {
      localVisible.value = [...localVisible.value, id];
    }
    markEditedAndPersist({ fields: ['visibleColumns'] });
  };

  const reorderColumns = (orderedIds: string[]) => {
    localOrder.value = sanitizeOrder(orderedIds);
    markEditedAndPersist({ fields: ['columnOrder'] });
  };

  /** `null` drops the custom width so the column flexes again. */
  const setColumnWidth = ({ id, widthPx }: { id: TABLE_COLUMN; widthPx: number | null }) => {
    if (widthPx === null && !(id in localWidths.value)) return;
    const next = { ...localWidths.value };
    if (widthPx === null) delete next[id];
    else next[id] = widthPx;
    localWidths.value = next;
    markEditedAndPersist({ fields: ['columnWidths'] });
  };

  const resetToDefaults = () => {
    localOrder.value = [...DEFAULT_COLUMN_ORDER];
    localVisible.value = [...DEFAULT_VISIBLE_COLUMNS];
    localWidths.value = {};
    markEditedAndPersist({ fields: ['visibleColumns', 'columnOrder', 'columnWidths'] });
  };

  return {
    visibleColumns,
    configurableColumns,
    toggleColumn,
    reorderColumns,
    setColumnWidth,
    resetToDefaults,
  };
}
