import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Appbar,
  Button,
  Chip,
  Dialog,
  Divider,
  HelperText,
  List,
  Modal,
  Portal,
  SegmentedButtons,
  Snackbar,
  Switch,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';
import {
  DEFAULT_PAGE_SETTINGS,
  DEFAULT_USER_SETTINGS,
  NOTIFICATION_EVENTS,
  STYLE_CATALOG_ITEMS,
  normalizePageSettings,
  normalizeUserSettings,
  serializePageSettings,
  type BrandVoice,
  type Page,
  type PageNotificationOverride,
  type PageSettings,
  type Photo,
  type StyleHistoryEntry,
  type UserSettings,
  type WeekdayKey,
} from '@cadencia/shared';
import {
  describeApiError,
  fetchUserSettings,
  updateUserSettings,
  type MetaConnectionStatus,
} from '../api';
import { radius, spacing } from '../theme';

type SettingsSection =
  | 'brand'
  | 'generation'
  | 'styles'
  | 'scheduling'
  | 'gallery'
  | 'page-notifications'
  | 'integrations'
  | 'page-advanced'
  | 'profile'
  | 'appearance'
  | 'global-notifications'
  | 'privacy'
  | 'global-advanced'
  | 'about';
type MaterialIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

type ConfirmAction = 'restore-page' | 'disconnect-page' | 'delete-page' | 'delete-account';

type PageSettingsPanelProps = {
  metaStatus?: MetaConnectionStatus;
  onChangePage: () => void;
  onDeletePage: () => Promise<boolean>;
  onDisconnectPage: () => Promise<boolean>;
  onReconnectMeta: () => void;
  onSavePageSettings: (settings: PageSettings, successMessage: string) => Promise<boolean>;
  onSignOut: () => void;
  page: Page;
  photos: Photo[];
  settingsSaving: boolean;
  signingOut: boolean;
  source: 'meta' | 'demo';
  styleHistory: StyleHistoryEntry[];
};

type SettingsSearchItem = {
  description: string;
  key: string;
  section: SettingsSection;
  title: string;
};

const searchItems: SettingsSearchItem[] = [
  {
    key: 'brand.voice',
    section: 'brand',
    title: 'Voz de marca',
    description: 'Tono, hashtags, menciones, firma y colores de marca.',
  },
  {
    key: 'generation.variants',
    section: 'generation',
    title: 'Generacion de contenido',
    description: 'Variantes, revision, modelos, idioma, SEO y prompt.',
  },
  {
    key: 'styles.active',
    section: 'styles',
    title: 'Estilos activos',
    description: 'Activar, desactivar, restaurar y ver uso de estilos.',
  },
  {
    key: 'scheduling.business_hours',
    section: 'scheduling',
    title: 'Programacion',
    description: 'Horario comercial, dias activos, gap y tope diario.',
  },
  {
    key: 'gallery.taxonomy',
    section: 'gallery',
    title: 'Galeria',
    description: 'Taxonomia, duplicados, calidad y orden inicial.',
  },
  {
    key: 'notifications.page',
    section: 'page-notifications',
    title: 'Notificaciones por pagina',
    description: 'Heredar, activar o silenciar eventos para esta pagina.',
  },
  {
    key: 'integrations.facebook',
    section: 'integrations',
    title: 'Facebook',
    description: 'Estado de conexion, permisos y reconexion.',
  },
  {
    key: 'advanced.export',
    section: 'page-advanced',
    title: 'Exportar configuracion',
    description: 'Ver JSON, restaurar defaults o preparar importacion.',
  },
  {
    key: 'account.profile',
    section: 'profile',
    title: 'Perfil',
    description: 'Nombre, correo y datos de cuenta.',
  },
  {
    key: 'account.appearance',
    section: 'appearance',
    title: 'Apariencia',
    description: 'Idioma, tema, region y zona horaria global.',
  },
  {
    key: 'account.notifications',
    section: 'global-notifications',
    title: 'Notificaciones defaults',
    description: 'Defaults de push, email y horas silenciosas.',
  },
  {
    key: 'account.privacy',
    section: 'privacy',
    title: 'Privacidad y datos',
    description: 'Exportar datos, sesiones activas y eliminar cuenta.',
  },
  {
    key: 'account.advanced',
    section: 'global-advanced',
    title: 'Avanzado de cuenta',
    description: 'Betas, logs, resincronizacion y reporte de problema.',
  },
  {
    key: 'account.about',
    section: 'about',
    title: 'Acerca de',
    description: 'Version, terminos, privacidad, licencias y cerrar sesion.',
  },
];

const brandVoices: BrandVoice[] = [
  'amigable',
  'formal',
  'entusiasta',
  'informativo',
  'humoristico',
  'inspirador',
];

const weekdays: Array<{ key: WeekdayKey; label: string }> = [
  { key: 'lun', label: 'Lun' },
  { key: 'mar', label: 'Mar' },
  { key: 'mie', label: 'Mie' },
  { key: 'jue', label: 'Jue' },
  { key: 'vie', label: 'Vie' },
  { key: 'sab', label: 'Sab' },
  { key: 'dom', label: 'Dom' },
];

export function PageSettingsPanel({
  metaStatus,
  onChangePage,
  onDeletePage,
  onDisconnectPage,
  onReconnectMeta,
  onSavePageSettings,
  onSignOut,
  page,
  photos,
  settingsSaving,
  signingOut,
  source,
  styleHistory,
}: PageSettingsPanelProps) {
  const theme = useTheme();
  const [section, setSection] = useState<SettingsSection | undefined>();
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<PageSettings>(() => normalizePageSettings(page.settings));
  const [userSettings, setUserSettings] = useState<UserSettings>(DEFAULT_USER_SETTINGS);
  const [userSaving, setUserSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [rawVisible, setRawVisible] = useState(false);
  const [stylePreviewId, setStylePreviewId] = useState<string | undefined>();
  const [confirmAction, setConfirmAction] = useState<
    ConfirmAction | undefined
  >();
  const [confirmText, setConfirmText] = useState('');
  const [undoSettings, setUndoSettings] = useState<PageSettings | undefined>();

  useEffect(() => {
    setDraft(normalizePageSettings(page.settings));
  }, [page.settings]);

  useEffect(() => {
    let active = true;

    fetchUserSettings()
      .then((settings) => {
        if (active) {
          setUserSettings(normalizeUserSettings(settings));
        }
      })
      .catch(() => {
        if (active) {
          setUserSettings(DEFAULT_USER_SETTINGS);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const styleUseCounts = useMemo(() => {
    const counts = new Map<string, number>();

    styleHistory.forEach((entry) => {
      counts.set(entry.style, (counts.get(entry.style) ?? 0) + 1);
    });

    return counts;
  }, [styleHistory]);
  const activeStyleCount = draft.styles.active.length;
  const pageMetaDisconnected = source === 'meta' && isPageMetaDisconnected(page);
  const firstPhoto = photos[0];
  const rawSettings = JSON.stringify(serializePageSettings(draft), null, 2);
  const filteredSearch = searchItems.filter((item) => normalizeSearch(`${item.title} ${item.description} ${item.key}`).includes(normalizeSearch(query)));

  const savePageDraft = async (next: PageSettings, message: string) => {
    const previous = normalizePageSettings(page.settings);
    setDraft(next);
    const ok = await onSavePageSettings(next, message);

    if (ok) {
      setUndoSettings(previous);
      setNotice(`${message} Puedes deshacer el cambio.`);
      return true;
    }

    setDraft(previous);
    return false;
  };

  const saveUserDraft = async (next: UserSettings, message: string) => {
    setUserSaving(true);
    const previous = userSettings;
    setUserSettings(next);

    try {
      const saved = await updateUserSettings(next);
      setUserSettings(normalizeUserSettings(saved));
      setNotice(message);
    } catch (error) {
      setUserSettings(previous);
      setNotice(describeApiError(error));
    } finally {
      setUserSaving(false);
    }
  };

  const disconnectPage = async () => {
    const ok = await onDisconnectPage();

    setConfirmAction(undefined);
    setConfirmText('');

    if (ok) {
      setNotice('Pagina desconectada de Cadencia. No se borro la pagina real de Facebook.');
    }
  };

  const deletePage = async () => {
    const ok = await onDeletePage();

    setConfirmAction(undefined);
    setConfirmText('');

    if (!ok) {
      setNotice('No pude eliminar la pagina. Revisa la conexion e intenta otra vez.');
    }
  };

  const openSection = (nextSection: SettingsSection) => {
    setSection(nextSection);
    setSearching(false);
    setQuery('');
  };

  if (section) {
    return (
      <View style={styles.section}>
        <Appbar.Header elevated={false} style={{ backgroundColor: theme.colors.surface }}>
          <Appbar.BackAction onPress={() => setSection(undefined)} />
          <Appbar.Content title={sectionTitle(section)} />
          {section === 'styles' || section === 'page-advanced' ? (
            <Appbar.Action
              accessibilityLabel="Restaurar"
              icon="restore"
              onPress={() => setConfirmAction('restore-page')}
            />
          ) : null}
        </Appbar.Header>
        <ScrollView contentContainerStyle={styles.detailContent} showsVerticalScrollIndicator={false}>
          {section === 'brand' ? (
            <BrandSection
              draft={draft}
              onChange={setDraft}
              onSave={(nextDraft = draft) => savePageDraft(nextDraft, 'Marca e identidad guardadas.')}
              saving={settingsSaving}
            />
          ) : null}
          {section === 'generation' ? (
            <GenerationSection
              draft={draft}
              onChange={setDraft}
              onSave={(nextDraft = draft) =>
                savePageDraft(nextDraft, 'Generacion de contenido guardada.')
              }
              saving={settingsSaving}
            />
          ) : null}
          {section === 'styles' ? (
            <StylesSection
              activeStyleCount={activeStyleCount}
              draft={draft}
              onChange={setDraft}
              onPreview={setStylePreviewId}
              onSave={() => savePageDraft(draft, 'Seleccion de estilos guardada.')}
              saving={settingsSaving}
              styleUseCounts={styleUseCounts}
            />
          ) : null}
          {section === 'scheduling' ? (
            <SchedulingSection
              draft={draft}
              onChange={setDraft}
              onSave={(nextDraft = draft) => savePageDraft(nextDraft, 'Programacion guardada.')}
              saving={settingsSaving}
            />
          ) : null}
          {section === 'gallery' ? (
            <GallerySection
              draft={draft}
              onChange={setDraft}
              onSave={(nextDraft = draft) => savePageDraft(nextDraft, 'Galeria guardada.')}
              saving={settingsSaving}
            />
          ) : null}
          {section === 'page-notifications' ? (
            <PageNotificationsSection
              draft={draft}
              onChange={setDraft}
              onSave={() => savePageDraft(draft, 'Notificaciones de la pagina guardadas.')}
              saving={settingsSaving}
            />
          ) : null}
          {section === 'integrations' ? (
            <IntegrationsSection
              metaStatus={metaStatus}
              onDisconnect={() => setConfirmAction('disconnect-page')}
              onManagePermissions={() =>
                setNotice('La administracion de permisos se abrira desde Facebook cuando el deep link este conectado.')
              }
              onReconnect={onReconnectMeta}
              page={page}
              source={source}
            />
          ) : null}
          {section === 'page-advanced' ? (
            <PageAdvancedSection
              onDeletePage={() => setConfirmAction('delete-page')}
              onDeletePageContent={() =>
                setNotice('Eliminar lotes y galeria requiere un endpoint dedicado antes de habilitarse.')
              }
              onImport={() =>
                setNotice('Importar configuracion esta preparado para conectar el selector de archivos JSON.')
              }
              onRaw={() => setRawVisible(true)}
              onRestore={() => setConfirmAction('restore-page')}
              rawSettings={rawSettings}
            />
          ) : null}
          {section === 'profile' ? <ProfileSection userSettings={userSettings} /> : null}
          {section === 'appearance' ? (
            <AppearanceSection
              onSave={saveUserDraft}
              saving={userSaving}
              userSettings={userSettings}
            />
          ) : null}
          {section === 'global-notifications' ? (
            <GlobalNotificationsSection
              onSave={saveUserDraft}
              saving={userSaving}
              userSettings={userSettings}
            />
          ) : null}
          {section === 'privacy' ? (
            <PrivacySection
              onDeleteAccount={() => setConfirmAction('delete-account')}
              onExportData={() => setNotice('Exportar datos requiere el endpoint ZIP global antes de habilitarse.')}
              onSessions={() => setNotice('Sesiones activas se conectara al proveedor de autenticacion.')}
            />
          ) : null}
          {section === 'global-advanced' ? (
            <GlobalAdvancedSection
              onOpenLogs={() => setNotice('Logs recientes se conectara al visor de eventos de soporte.')}
              onReportIssue={() => setNotice('Reportar problema se conectara al formulario con logs adjuntos.')}
              onResync={() => setNotice('Forzar resincronizacion se conectara al flujo de metadata de Supabase.')}
              userSettings={userSettings}
            />
          ) : null}
          {section === 'about' ? (
            <AboutSection onSignOut={onSignOut} signingOut={signingOut} />
          ) : null}
        </ScrollView>
        <SettingsPortals
          confirmAction={confirmAction}
          confirmText={confirmText}
          firstPhoto={firstPhoto}
          notice={notice}
          onClearConfirm={() => {
            setConfirmAction(undefined);
            setConfirmText('');
          }}
          onConfirmText={setConfirmText}
          onDismissNotice={() => setNotice('')}
          onRestorePage={() => {
            void savePageDraft(DEFAULT_PAGE_SETTINGS, 'Valores de fabrica restaurados.');
            setConfirmAction(undefined);
            setConfirmText('');
          }}
          onDisconnectPage={() => void disconnectPage()}
          onDeletePage={() => void deletePage()}
          onDeleteAccount={() => {
            setConfirmAction(undefined);
            setConfirmText('');
            setNotice(
              'Eliminar cuenta requiere el endpoint global de cuenta; la confirmacion ya esta preparada.',
            );
          }}
          onUndo={undoSettings ? () => void savePageDraft(undoSettings, 'Cambio deshecho.') : undefined}
          pageName={page.name}
          rawSettings={rawSettings}
          rawVisible={rawVisible}
          setRawVisible={setRawVisible}
          stylePreviewId={stylePreviewId}
          styleUseCounts={styleUseCounts}
          onCloseStylePreview={() => setStylePreviewId(undefined)}
        />
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <View style={styles.headerRow}>
        <View style={styles.headerTitle}>
          <Text variant="titleLarge">Configuracion</Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            Ajustes aislados para {page.name} y defaults de tu cuenta.
          </Text>
        </View>
        <Button compact icon={searching ? 'close' : 'magnify'} onPress={() => setSearching((value) => !value)}>
          {searching ? 'Cerrar' : 'Buscar'}
        </Button>
      </View>
      {searching ? (
        <TextInput
          accessibilityLabel="Buscar ajustes"
          mode="outlined"
          label="Buscar ajustes"
          placeholder="Busca por nombre o descripcion"
          value={query}
          onChangeText={setQuery}
          right={<TextInput.Icon icon="magnify" />}
        />
      ) : null}
      {searching && query.trim() ? (
        <List.Section>
          <List.Subheader>Resultados</List.Subheader>
          {filteredSearch.map((item) => (
            <List.Item
              key={item.key}
              description={item.description}
              left={(props) => <List.Icon {...props} icon={sectionIcon(item.section)} />}
              onPress={() => openSection(item.section)}
              right={(props) => <List.Icon {...props} icon="chevron-right" />}
              title={item.title}
            />
          ))}
          {filteredSearch.length === 0 ? (
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              No encontre ajustes con esa busqueda.
            </Text>
          ) : null}
        </List.Section>
      ) : (
        <List.Section>
          <List.Subheader>Esta pagina</List.Subheader>
          <MenuItem
            description={draft.brand.defaultHashtags.length > 0 ? draft.brand.defaultHashtags.join(' ') : 'Voz, hashtags y firma'}
            icon="palette-outline"
            onPress={() => openSection('brand')}
            title="Marca e identidad"
          />
          <MenuItem
            description={`${draft.generation.defaultVariantsPerPhoto} variantes por foto - ${draft.generation.textModel}`}
            icon="auto-fix"
            onPress={() => openSection('generation')}
            title="Generacion de contenido"
          />
          <MenuItem
            description={`${activeStyleCount} de ${STYLE_CATALOG_ITEMS.length} activos - minimo 5`}
            icon="image-filter-vintage"
            onPress={() => openSection('styles')}
            title="Estilos"
          />
          <MenuItem
            description={`${draft.scheduling.businessHours.start} - ${draft.scheduling.businessHours.end} - ${draft.scheduling.maxPostsPerDay}/dia`}
            icon="calendar-clock"
            onPress={() => openSection('scheduling')}
            title="Programacion"
          />
          <MenuItem
            description={`${draft.gallery.taxonomy.length} categorias - duplicados: ${draft.gallery.duplicatePolicy}`}
            icon="image-multiple-outline"
            onPress={() => openSection('gallery')}
            title="Galeria"
          />
          <MenuItem
            description="Heredado por defecto, con overrides por evento"
            icon="bell-outline"
            onPress={() => openSection('page-notifications')}
            title="Notificaciones"
          />
          <MenuItem
            description={
              pageMetaDisconnected
                ? 'Facebook desconectado para esta pagina'
                : metaStatus?.ok
                  ? 'Facebook conectado'
                  : 'Facebook necesita revision'
            }
            icon="connection"
            onPress={() => openSection('integrations')}
            title="Integraciones"
          />
          <MenuItem
            description="Exportar, importar, restaurar y datos crudos"
            icon="cog-outline"
            onPress={() => openSection('page-advanced')}
            title="Avanzado"
          />
          <Divider />
          <List.Subheader>Cuenta</List.Subheader>
          <MenuItem
            description={userSettings.email || 'Datos de Facebook'}
            icon="account-circle-outline"
            onPress={() => openSection('profile')}
            title="Perfil"
          />
          <MenuItem
            description={`${userSettings.language.toUpperCase()} - tema ${userSettings.theme}`}
            icon="theme-light-dark"
            onPress={() => openSection('appearance')}
            title="Apariencia"
          />
          <MenuItem
            description="Defaults globales de push, email y horas silenciosas"
            icon="bell-cog-outline"
            onPress={() => openSection('global-notifications')}
            title="Notificaciones (defaults)"
          />
          <MenuItem
            description="Exportar datos, sesiones y eliminacion"
            icon="shield-lock-outline"
            onPress={() => openSection('privacy')}
            title="Privacidad y datos"
          />
          <MenuItem
            description="Betas, logs, resincronizacion y soporte"
            icon="test-tube"
            onPress={() => openSection('global-advanced')}
            title="Avanzado"
          />
          <MenuItem
            description="Version, terminos, licencias y sesion"
            icon="information-outline"
            onPress={() => openSection('about')}
            title="Acerca de"
          />
          <List.Item
            disabled={signingOut}
            left={(props) => <List.Icon {...props} icon="logout" />}
            onPress={onSignOut}
            right={() => (signingOut ? <ActivityIndicator /> : null)}
            title="Cerrar sesion"
          />
          <Button icon="swap-horizontal" mode="outlined" onPress={onChangePage} style={styles.primaryButton}>
            Cambiar pagina activa
          </Button>
        </List.Section>
      )}
    </View>
  );
}

function BrandSection({
  draft,
  onChange,
  onSave,
  saving,
}: {
  draft: PageSettings;
  onChange: (settings: PageSettings) => void;
  onSave: (settings?: PageSettings) => void;
  saving: boolean;
}) {
  const [hashtagsText, setHashtagsText] = useState(draft.brand.defaultHashtags.join(', '));
  const [colorsText, setColorsText] = useState(draft.brand.brandColors.join(', '));

  useEffect(() => {
    setHashtagsText(draft.brand.defaultHashtags.join(', '));
    setColorsText(draft.brand.brandColors.join(', '));
  }, [draft.brand.brandColors, draft.brand.defaultHashtags]);

  const validation = validateBrand(draft, hashtagsText, colorsText);

  return (
    <View style={styles.section}>
      <Text variant="titleMedium">Voz de marca</Text>
      <View style={styles.chips}>
        {brandVoices.map((voice) => (
          <Chip
            key={voice}
            selected={draft.brand.voice === voice}
            onPress={() => onChange({ ...draft, brand: { ...draft.brand, voice } })}
          >
            {voice}
          </Chip>
        ))}
      </View>
      <TextInput
        mode="outlined"
        label="Instruccion adicional"
        multiline
        value={draft.brand.voiceCustom}
        onChangeText={(voiceCustom) => onChange({ ...draft, brand: { ...draft.brand, voiceCustom } })}
      />
      <HelperText type={draft.brand.voiceCustom.length > 280 ? 'error' : 'info'} visible>
        {draft.brand.voiceCustom.length}/280 caracteres.
      </HelperText>
      <TextInput
        error={Boolean(validation.hashtags)}
        mode="outlined"
        label="Hashtags por defecto"
        placeholder="#SushiVidaTapalpa, #Tapalpa"
        value={hashtagsText}
        onChangeText={setHashtagsText}
      />
      <HelperText type={validation.hashtags ? 'error' : 'info'} visible>
        {validation.hashtags ?? 'Separalos con coma. Maximo 30.'}
      </HelperText>
      <TextInput
        mode="outlined"
        label="Firma"
        value={draft.brand.signature}
        onChangeText={(signature) => onChange({ ...draft, brand: { ...draft.brand, signature } })}
      />
      <TextInput
        error={Boolean(validation.colors)}
        mode="outlined"
        label="Colores de marca"
        placeholder="#1B3A57, #E8A87C"
        value={colorsText}
        onChangeText={setColorsText}
      />
      <HelperText type={validation.colors ? 'error' : 'info'} visible>
        {validation.colors ?? 'Valores HEX para uso futuro en Canva.'}
      </HelperText>
      <Button
        disabled={saving || Boolean(validation.hashtags || validation.colors)}
        loading={saving}
        mode="contained"
        onPress={() => {
          const nextDraft = {
            ...draft,
            brand: {
              ...draft.brand,
              brandColors: listFromText(colorsText),
              defaultHashtags: listFromText(hashtagsText),
            },
          };
          onChange(nextDraft);
          onSave(nextDraft);
        }}
      >
        Guardar cambios
      </Button>
    </View>
  );
}

function GenerationSection({
  draft,
  onChange,
  onSave,
  saving,
}: {
  draft: PageSettings;
  onChange: (settings: PageSettings) => void;
  onSave: (settings?: PageSettings) => void;
  saving: boolean;
}) {
  const [keywordsText, setKeywordsText] = useState(draft.generation.seoKeywords.join(', '));
  const validation = validateKeywords(keywordsText);

  useEffect(() => {
    setKeywordsText(draft.generation.seoKeywords.join(', '));
  }, [draft.generation.seoKeywords]);

  return (
    <View style={styles.section}>
      <CounterRow
        label="Variantes por foto"
        max={10}
        min={1}
        value={draft.generation.defaultVariantsPerPhoto}
        onChange={(defaultVariantsPerPhoto) =>
          onChange({
            ...draft,
            generation: { ...draft.generation, defaultVariantsPerPhoto },
          })
        }
      />
      <SettingsSwitch
        description="Los nuevos lotes pueden pasar directo a programacion."
        label="Saltar revision por defecto"
        value={draft.generation.skipReviewDefault}
        onChange={(skipReviewDefault) =>
          onChange({ ...draft, generation: { ...draft.generation, skipReviewDefault } })
        }
      />
      <SegmentedButtons
        value={draft.generation.defaultContextMode}
        onValueChange={(value) =>
          onChange({
            ...draft,
            generation: {
              ...draft.generation,
              defaultContextMode: value as PageSettings['generation']['defaultContextMode'],
            },
          })
        }
        buttons={[
          { value: 'ai', label: 'Auto IA', icon: 'auto-fix' },
          { value: 'manual', label: 'Manual', icon: 'pencil' },
        ]}
      />
      <SegmentedButtons
        value={draft.generation.postingLanguage}
        onValueChange={(value) =>
          onChange({
            ...draft,
            generation: {
              ...draft.generation,
              postingLanguage: value as PageSettings['generation']['postingLanguage'],
            },
          })
        }
        buttons={[
          { value: 'inherit', label: 'Heredar' },
          { value: 'es', label: 'ES' },
          { value: 'en', label: 'EN' },
          { value: 'auto', label: 'Auto' },
        ]}
      />
      <InfoRow icon="image-edit-outline" label="Modelo de imagen" value={draft.generation.imageModel} />
      <InfoRow icon="text-box-edit-outline" label="Modelo de texto" value={draft.generation.textModel} />
      <TextInput
        error={Boolean(validation)}
        mode="outlined"
        label="Palabras SEO"
        placeholder="sushi, tapalpa, rollos"
        value={keywordsText}
        onChangeText={setKeywordsText}
      />
      <HelperText type={validation ? 'error' : 'info'} visible>
        {validation ?? 'Maximo 20 palabras, 30 caracteres cada una.'}
      </HelperText>
      <TextInput
        mode="outlined"
        label="Prompt avanzado"
        multiline
        value={draft.generation.promptSuffix}
        onChangeText={(promptSuffix) =>
          onChange({ ...draft, generation: { ...draft.generation, promptSuffix } })
        }
      />
      <Button
        disabled={saving || Boolean(validation)}
        loading={saving}
        mode="contained"
        onPress={() => {
          const nextDraft = {
            ...draft,
            generation: {
              ...draft.generation,
              seoKeywords: listFromText(keywordsText).slice(0, 20),
            },
          };
          onChange(nextDraft);
          onSave(nextDraft);
        }}
      >
        Guardar cambios
      </Button>
    </View>
  );
}

function StylesSection({
  activeStyleCount,
  draft,
  onChange,
  onPreview,
  onSave,
  saving,
  styleUseCounts,
}: {
  activeStyleCount: number;
  draft: PageSettings;
  onChange: (settings: PageSettings) => void;
  onPreview: (styleId: string) => void;
  onSave: () => void;
  saving: boolean;
  styleUseCounts: Map<string, number>;
}) {
  const theme = useTheme();
  const active = new Set(draft.styles.active);
  const grouped = groupStyles();

  const setActive = (nextActive: string[]) => {
    onChange({
      ...draft,
      styles: {
        ...draft.styles,
        active: nextActive,
      },
    });
  };

  return (
    <View style={styles.section}>
      <View style={[styles.notice, { backgroundColor: theme.colors.surfaceVariant }]}>
        <Text variant="titleMedium">Activos: {activeStyleCount} de {STYLE_CATALOG_ITEMS.length}</Text>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
          Minimo 5 estilos activos para mantener variedad en publicaciones nuevas.
        </Text>
      </View>
      {activeStyleCount < 5 ? (
        <HelperText type="error" visible>
          Activa al menos 5 estilos antes de guardar.
        </HelperText>
      ) : null}
      <View style={styles.buttonRow}>
        <Button compact mode="outlined" onPress={() => setActive(STYLE_CATALOG_ITEMS.map((style) => style.id))}>
          Activar todos
        </Button>
        <Button compact mode="outlined" onPress={() => setActive(STYLE_CATALOG_ITEMS.slice(0, 5).map((style) => style.id))}>
          Minimo 5
        </Button>
      </View>
      {grouped.map(([group, items]) => (
        <List.Section key={group}>
          <List.Subheader>{group}</List.Subheader>
          {items.map((style) => {
            const used = styleUseCounts.get(style.name) ?? 0;
            const enabled = active.has(style.id) || active.has(style.name);

            return (
              <List.Item
                key={style.id}
                description={`usado ${used}x`}
                left={() => (
                  <Switch
                    value={enabled}
                    onValueChange={(value) => {
                      const nextActive = value
                        ? [...draft.styles.active, style.id]
                        : draft.styles.active.filter((id) => id !== style.id && id !== style.name);
                      setActive(nextActive);
                    }}
                  />
                )}
                onPress={() => onPreview(style.id)}
                right={(props) => <List.Icon {...props} icon="eye-outline" />}
                title={style.name}
              />
            );
          })}
        </List.Section>
      ))}
      <Button disabled={saving || activeStyleCount < 5} loading={saving} mode="contained" onPress={onSave}>
        Guardar estilos
      </Button>
    </View>
  );
}

function SchedulingSection({
  draft,
  onChange,
  onSave,
  saving,
}: {
  draft: PageSettings;
  onChange: (settings: PageSettings) => void;
  onSave: (settings?: PageSettings) => void;
  saving: boolean;
}) {
  const [start, setStart] = useState(draft.scheduling.businessHours.start);
  const [end, setEnd] = useState(draft.scheduling.businessHours.end);
  const validation = validateBusinessHours(start, end);

  useEffect(() => {
    setStart(draft.scheduling.businessHours.start);
    setEnd(draft.scheduling.businessHours.end);
  }, [draft.scheduling.businessHours.end, draft.scheduling.businessHours.start]);

  return (
    <View style={styles.section}>
      <TextInput
        mode="outlined"
        label="Zona horaria"
        value={draft.scheduling.timezone}
        onChangeText={(timezone) =>
          onChange({ ...draft, scheduling: { ...draft.scheduling, timezone } })
        }
      />
      <View style={styles.timeRow}>
        <TextInput error={Boolean(validation)} mode="outlined" label="Inicio" value={start} onChangeText={setStart} style={styles.timeField} />
        <TextInput error={Boolean(validation)} mode="outlined" label="Fin" value={end} onChangeText={setEnd} style={styles.timeField} />
      </View>
      <HelperText type={validation ? 'error' : 'info'} visible>
        {validation ?? 'Formato HH:MM, ventana minima de 1 hora.'}
      </HelperText>
      <Text variant="titleSmall">Dias activos</Text>
      <View style={styles.chips}>
        {weekdays.map((day) => (
          <Chip
            key={day.key}
            selected={draft.scheduling.activeDays.includes(day.key)}
            onPress={() => {
              const activeDays = draft.scheduling.activeDays.includes(day.key)
                ? draft.scheduling.activeDays.filter((value) => value !== day.key)
                : [...draft.scheduling.activeDays, day.key];
              onChange({
                ...draft,
                scheduling: {
                  ...draft.scheduling,
                  activeDays: activeDays.length > 0 ? activeDays : [day.key],
                },
              });
            }}
          >
            {day.label}
          </Chip>
        ))}
      </View>
      <CounterRow
        label="Gap minimo (min)"
        max={1440}
        min={5}
        step={5}
        value={draft.scheduling.minGapMinutes}
        onChange={(minGapMinutes) =>
          onChange({ ...draft, scheduling: { ...draft.scheduling, minGapMinutes } })
        }
      />
      <CounterRow
        label="Maximo por dia"
        max={50}
        min={1}
        value={draft.scheduling.maxPostsPerDay}
        onChange={(maxPostsPerDay) =>
          onChange({ ...draft, scheduling: { ...draft.scheduling, maxPostsPerDay } })
        }
      />
      <SegmentedButtons
        value={draft.scheduling.startTodayOrTomorrow}
        onValueChange={(value) =>
          onChange({
            ...draft,
            scheduling: {
              ...draft.scheduling,
              startTodayOrTomorrow: value as PageSettings['scheduling']['startTodayOrTomorrow'],
            },
          })
        }
        buttons={[
          { value: 'today', label: 'Hoy' },
          { value: 'tomorrow', label: 'Manana' },
        ]}
      />
      <SettingsSwitch
        description="Si se apaga, los slots se eligen al azar dentro de la ventana."
        label="Distribuir uniformemente"
        value={draft.scheduling.distributeEvenly}
        onChange={(distributeEvenly) =>
          onChange({ ...draft, scheduling: { ...draft.scheduling, distributeEvenly } })
        }
      />
      <Button
        disabled={saving || Boolean(validation)}
        loading={saving}
        mode="contained"
        onPress={() => {
          const nextDraft = {
            ...draft,
            scheduling: {
              ...draft.scheduling,
              businessHours: { start: start.trim(), end: end.trim() },
            },
          };
          onChange(nextDraft);
          onSave(nextDraft);
        }}
      >
        Guardar programacion
      </Button>
    </View>
  );
}

function GallerySection({
  draft,
  onChange,
  onSave,
  saving,
}: {
  draft: PageSettings;
  onChange: (settings: PageSettings) => void;
  onSave: (settings?: PageSettings) => void;
  saving: boolean;
}) {
  const [taxonomyText, setTaxonomyText] = useState(draft.gallery.taxonomy.join(', '));

  useEffect(() => {
    setTaxonomyText(draft.gallery.taxonomy.join(', '));
  }, [draft.gallery.taxonomy]);

  return (
    <View style={styles.section}>
      <TextInput
        mode="outlined"
        label="Taxonomia"
        multiline
        value={taxonomyText}
        onChangeText={setTaxonomyText}
      />
      <SegmentedButtons
        value={draft.gallery.duplicatePolicy}
        onValueChange={(value) =>
          onChange({
            ...draft,
            gallery: {
              ...draft.gallery,
              duplicatePolicy: value as PageSettings['gallery']['duplicatePolicy'],
            },
          })
        }
        buttons={[
          { value: 'block', label: 'Bloquear' },
          { value: 'warn_only', label: 'Avisar' },
        ]}
      />
      <SegmentedButtons
        value={draft.gallery.defaultSort}
        onValueChange={(value) =>
          onChange({
            ...draft,
            gallery: {
              ...draft.gallery,
              defaultSort: value as PageSettings['gallery']['defaultSort'],
            },
          })
        }
        buttons={[
          { value: 'recent', label: 'Recientes' },
          { value: 'oldest', label: 'Antiguas' },
          { value: 'most_used', label: 'Usadas' },
        ]}
      />
      <CounterRow
        label="Ventana de pilas (min)"
        max={120}
        min={1}
        value={draft.gallery.stackTimeWindowMinutes}
        onChange={(stackTimeWindowMinutes) =>
          onChange({ ...draft, gallery: { ...draft.gallery, stackTimeWindowMinutes } })
        }
      />
      <CounterRow
        label="Auto-archivar tras dias"
        max={3650}
        min={0}
        value={draft.gallery.autoArchiveAfterDays}
        onChange={(autoArchiveAfterDays) =>
          onChange({ ...draft, gallery: { ...draft.gallery, autoArchiveAfterDays } })
        }
      />
      <Button
        disabled={saving || listFromText(taxonomyText).length === 0}
        loading={saving}
        mode="contained"
        onPress={() => {
          const nextDraft = {
            ...draft,
            gallery: {
              ...draft.gallery,
              taxonomy: listFromText(taxonomyText).slice(0, 40),
            },
          };
          onChange(nextDraft);
          onSave(nextDraft);
        }}
      >
        Guardar galeria
      </Button>
    </View>
  );
}

function PageNotificationsSection({
  draft,
  onChange,
  onSave,
  saving,
}: {
  draft: PageSettings;
  onChange: (settings: PageSettings) => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <View style={styles.section}>
      {NOTIFICATION_EVENTS.map((event) => (
        <View key={event.key} style={styles.settingBlock}>
          <Text variant="titleSmall">{event.title}</Text>
          <Text variant="bodySmall">{event.description}</Text>
          <SegmentedButtons
            value={draft.notifications[event.key]}
            onValueChange={(value) =>
              onChange({
                ...draft,
                notifications: {
                  ...draft.notifications,
                  [event.key]: value as PageNotificationOverride,
                },
              })
            }
            buttons={[
              { value: 'inherit', label: 'Heredar' },
              { value: 'enabled', label: 'On' },
              { value: 'disabled', label: 'Off' },
            ]}
          />
        </View>
      ))}
      <Button disabled={saving} loading={saving} mode="contained" onPress={onSave}>
        Guardar notificaciones
      </Button>
    </View>
  );
}

function IntegrationsSection({
  metaStatus,
  onDisconnect,
  onManagePermissions,
  onReconnect,
  page,
  source,
}: {
  metaStatus?: MetaConnectionStatus;
  onDisconnect: () => void;
  onManagePermissions: () => void;
  onReconnect: () => void;
  page: Page;
  source: 'meta' | 'demo';
}) {
  const theme = useTheme();
  const pageMetaDisconnected = source === 'meta' && isPageMetaDisconnected(page);
  const connected = source === 'meta' && metaStatus?.ok && !pageMetaDisconnected;

  return (
    <View style={styles.section}>
      <View style={[styles.integrationCard, { backgroundColor: theme.colors.surfaceVariant }]}>
        <MaterialCommunityIcons color="#1877F2" name="facebook" size={44} />
        <Text variant="titleMedium">
          {connected ? 'Conectado' : pageMetaDisconnected ? 'Pagina desconectada' : 'Requiere conexion'}
        </Text>
        <Text variant="bodyMedium">{page.name}</Text>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
          {pageMetaDisconnected
            ? 'Token eliminado en Cadencia. Puedes reconectar con Facebook.'
            : source === 'meta'
              ? 'Token administrado por el backend.'
              : 'Datos de muestra sin token real.'}
        </Text>
      </View>
      <List.Section>
        <List.Subheader>Permisos otorgados</List.Subheader>
        {['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'public_profile'].map((permission) => (
          <List.Item key={permission} left={(props) => <List.Icon {...props} icon="check-circle-outline" />} title={permission} />
        ))}
      </List.Section>
      <Button icon="facebook" mode="contained" onPress={onReconnect}>
        Reconectar
      </Button>
      <Button mode="outlined" onPress={onManagePermissions}>
        Administrar permisos en Facebook
      </Button>
      <Button icon="link-off" mode="outlined" onPress={onDisconnect} textColor={theme.colors.error}>
        Desconectar pagina
      </Button>
      <List.Section>
        <List.Subheader>Proximamente</List.Subheader>
        {['Instagram Business', 'X (Twitter)', 'TikTok for Business', 'Threads'].map((name) => (
          <List.Item key={name} description="Bloque reservado para v2" title={name} />
        ))}
      </List.Section>
    </View>
  );
}

function PageAdvancedSection({
  onDeletePageContent,
  onDeletePage,
  onImport,
  onRaw,
  onRestore,
}: {
  onDeletePageContent: () => void;
  onDeletePage: () => void;
  onImport: () => void;
  onRaw: () => void;
  onRestore: () => void;
  rawSettings: string;
}) {
  const theme = useTheme();

  return (
    <List.Section>
      <List.Item description="Muestra el JSON listo para copiar o guardar." left={(props) => <List.Icon {...props} icon="download-outline" />} onPress={onRaw} title="Exportar configuracion" />
      <List.Item description="Validacion de JSON preparada para conectar al selector de archivos." left={(props) => <List.Icon {...props} icon="upload-outline" />} onPress={onImport} title="Importar configuracion" />
      <List.Item description="Restaura todas las secciones de esta pagina." left={(props) => <List.Icon {...props} icon="restore" />} onPress={onRestore} title="Restaurar valores por defecto" />
      <List.Item description="Abre el JSON completo de pages.settings." left={(props) => <List.Icon {...props} icon="code-json" />} onPress={onRaw} title="Ver datos crudos" />
      <List.Item description="Accion destructiva pendiente de endpoint dedicado." left={(props) => <List.Icon {...props} icon="delete-sweep-outline" />} onPress={onDeletePageContent} title="Eliminar todos los lotes y la galeria" titleStyle={{ color: theme.colors.error }} />
      <List.Item description="No afecta la pagina real de Facebook." left={(props) => <List.Icon {...props} icon="trash-can-outline" />} onPress={onDeletePage} title="Eliminar la pagina de Cadencia" titleStyle={{ color: theme.colors.error }} />
    </List.Section>
  );
}

function ProfileSection({ userSettings }: { userSettings: UserSettings }) {
  return (
    <View style={styles.section}>
      <InfoRow icon="account-outline" label="Nombre" value={userSettings.displayName} />
      <InfoRow icon="email-outline" label="Email" value={userSettings.email || 'Sin email sincronizado'} />
      <InfoRow icon="lock-outline" label="Origen" value="Solo lectura desde Facebook en v1" />
    </View>
  );
}

function AppearanceSection({
  onSave,
  saving,
  userSettings,
}: {
  onSave: (settings: UserSettings, message: string) => void;
  saving: boolean;
  userSettings: UserSettings;
}) {
  const [draft, setDraft] = useState(userSettings);

  useEffect(() => {
    setDraft(userSettings);
  }, [userSettings]);

  return (
    <View style={styles.section}>
      <SegmentedButtons
        value={draft.language}
        onValueChange={(language) => setDraft({ ...draft, language: language as UserSettings['language'] })}
        buttons={[
          { value: 'es', label: 'ES' },
          { value: 'en', label: 'EN' },
        ]}
      />
      <SegmentedButtons
        value={draft.theme}
        onValueChange={(theme) => setDraft({ ...draft, theme: theme as UserSettings['theme'] })}
        buttons={[
          { value: 'system', label: 'Sistema' },
          { value: 'light', label: 'Claro' },
          { value: 'dark', label: 'Oscuro' },
        ]}
      />
      <TextInput mode="outlined" label="Region" value={draft.region} onChangeText={(region) => setDraft({ ...draft, region })} />
      <TextInput mode="outlined" label="Zona horaria por defecto" value={draft.defaultTimezone} onChangeText={(defaultTimezone) => setDraft({ ...draft, defaultTimezone })} />
      <Button loading={saving} mode="contained" onPress={() => onSave(draft, 'Apariencia guardada.')}>
        Guardar apariencia
      </Button>
    </View>
  );
}

function GlobalNotificationsSection({
  onSave,
  saving,
  userSettings,
}: {
  onSave: (settings: UserSettings, message: string) => void;
  saving: boolean;
  userSettings: UserSettings;
}) {
  const [draft, setDraft] = useState(userSettings);
  const quiet = draft.quietHours ?? { start: '22:00', end: '07:00' };

  useEffect(() => {
    setDraft(userSettings);
  }, [userSettings]);

  return (
    <View style={styles.section}>
      {NOTIFICATION_EVENTS.map((event) => (
        <View key={event.key} style={styles.settingBlock}>
          <Text variant="titleSmall">{event.title}</Text>
          <SettingsSwitch
            description="Canal push"
            label="Push"
            value={draft.notifications[event.key]?.push ?? false}
            onChange={(push) =>
              setDraft({
                ...draft,
                notifications: {
                  ...draft.notifications,
                  [event.key]: {
                    ...(draft.notifications[event.key] ?? { email: false, push: false }),
                    push,
                  },
                },
              })
            }
          />
          <SettingsSwitch
            description="Canal email"
            label="Email"
            value={draft.notifications[event.key]?.email ?? false}
            onChange={(email) =>
              setDraft({
                ...draft,
                notifications: {
                  ...draft.notifications,
                  [event.key]: {
                    ...(draft.notifications[event.key] ?? { email: false, push: false }),
                    email,
                  },
                },
              })
            }
          />
        </View>
      ))}
      <SettingsSwitch
        description="Suprime push, no email, dentro de la ventana."
        label="Horas silenciosas"
        value={Boolean(draft.quietHours)}
        onChange={(enabled) => setDraft({ ...draft, quietHours: enabled ? quiet : null })}
      />
      {draft.quietHours ? (
        <View style={styles.timeRow}>
          <TextInput
            mode="outlined"
            label="Inicio"
            value={quiet.start}
            onChangeText={(start) => setDraft({ ...draft, quietHours: { ...quiet, start } })}
            style={styles.timeField}
          />
          <TextInput
            mode="outlined"
            label="Fin"
            value={quiet.end}
            onChangeText={(end) => setDraft({ ...draft, quietHours: { ...quiet, end } })}
            style={styles.timeField}
          />
        </View>
      ) : null}
      <Button loading={saving} mode="contained" onPress={() => onSave(draft, 'Defaults de notificaciones guardados.')}>
        Guardar defaults
      </Button>
    </View>
  );
}

function PrivacySection({
  onDeleteAccount,
  onExportData,
  onSessions,
}: {
  onDeleteAccount: () => void;
  onExportData: () => void;
  onSessions: () => void;
}) {
  const theme = useTheme();

  return (
    <List.Section>
      <List.Item description="Genera un ZIP con JSON y archivos de todas tus paginas." left={(props) => <List.Icon {...props} icon="archive-arrow-down-outline" />} onPress={onExportData} title="Exportar mis datos" />
      <List.Item description="Este dispositivo - sesion activa." left={(props) => <List.Icon {...props} icon="cellphone" />} onPress={onSessions} title="Sesiones activas" />
      <List.Item description="Accion irreversible. Requiere escribir el nombre de la cuenta." left={(props) => <List.Icon {...props} icon="account-remove-outline" />} onPress={onDeleteAccount} title="Eliminar cuenta" titleStyle={{ color: theme.colors.error }} />
    </List.Section>
  );
}

function GlobalAdvancedSection({
  onOpenLogs,
  onReportIssue,
  onResync,
  userSettings,
}: {
  onOpenLogs: () => void;
  onReportIssue: () => void;
  onResync: () => void;
  userSettings: UserSettings;
}) {
  return (
    <List.Section>
      <List.Item description={userSettings.betaFeatures.length > 0 ? userSettings.betaFeatures.join(', ') : 'Sin betas activas'} left={(props) => <List.Icon {...props} icon="test-tube" />} title="Funciones beta" />
      <List.Item description="Ultimos eventos de la app para soporte." left={(props) => <List.Icon {...props} icon="text-box-search-outline" />} onPress={onOpenLogs} title="Ver logs recientes" />
      <List.Item description="Re-descarga metadata desde Supabase." left={(props) => <List.Icon {...props} icon="sync" />} onPress={onResync} title="Forzar resincronizacion" />
      <List.Item description="Abre un reporte con logs adjuntos." left={(props) => <List.Icon {...props} icon="bug-outline" />} onPress={onReportIssue} title="Reportar un problema" />
    </List.Section>
  );
}

function AboutSection({ onSignOut, signingOut }: { onSignOut: () => void; signingOut: boolean }) {
  return (
    <List.Section>
      <List.Item description="0.1.0" left={(props) => <List.Icon {...props} icon="cellphone-information" />} title="Version de la app" />
      <List.Item left={(props) => <List.Icon {...props} icon="file-document-outline" />} title="Terminos de servicio" />
      <List.Item left={(props) => <List.Icon {...props} icon="shield-lock-outline" />} title="Politica de privacidad" />
      <List.Item left={(props) => <List.Icon {...props} icon="license" />} title="Licencias de terceros" />
      <List.Item disabled={signingOut} left={(props) => <List.Icon {...props} icon="logout" />} onPress={onSignOut} right={() => (signingOut ? <ActivityIndicator /> : null)} title="Cerrar sesion" />
    </List.Section>
  );
}

function SettingsPortals({
  confirmAction,
  confirmText,
  firstPhoto,
  notice,
  onClearConfirm,
  onCloseStylePreview,
  onConfirmText,
  onDismissNotice,
  onDisconnectPage,
  onDeletePage,
  onDeleteAccount,
  onRestorePage,
  onUndo,
  pageName,
  rawSettings,
  rawVisible,
  setRawVisible,
  stylePreviewId,
  styleUseCounts,
}: {
  confirmAction?: ConfirmAction;
  confirmText: string;
  firstPhoto?: Photo;
  notice: string;
  onClearConfirm: () => void;
  onCloseStylePreview: () => void;
  onConfirmText: (value: string) => void;
  onDismissNotice: () => void;
  onDisconnectPage: () => void;
  onDeletePage: () => void;
  onDeleteAccount: () => void;
  onRestorePage: () => void;
  onUndo?: () => void;
  pageName: string;
  rawSettings: string;
  rawVisible: boolean;
  setRawVisible: (visible: boolean) => void;
  stylePreviewId?: string;
  styleUseCounts: Map<string, number>;
}) {
  const theme = useTheme();
  const styleItem = STYLE_CATALOG_ITEMS.find((style) => style.id === stylePreviewId);
  const requiresName = confirmAction === 'delete-page' || confirmAction === 'delete-account';
  const canConfirm = !requiresName || confirmText.trim() === pageName;

  return (
    <Portal>
      <Modal
        contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.surface }]}
        onDismiss={() => setRawVisible(false)}
        visible={rawVisible}
      >
        <ScrollView contentContainerStyle={styles.section}>
          <Text variant="titleMedium">Datos crudos</Text>
          <Text selectable variant="bodySmall" style={styles.codeBlock}>
            {rawSettings}
          </Text>
          <Button mode="contained" onPress={() => setRawVisible(false)}>
            Listo
          </Button>
        </ScrollView>
      </Modal>
      <Modal
        contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.surface }]}
        onDismiss={onCloseStylePreview}
        visible={Boolean(styleItem)}
      >
        {styleItem ? (
          <View style={styles.section}>
            {firstPhoto ? (
              <Image source={{ uri: firstPhoto.thumbnailUrl }} style={styles.previewImage} contentFit="cover" />
            ) : null}
            <Text variant="titleMedium">{styleItem.name}</Text>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              Usado {styleUseCounts.get(styleItem.name) ?? 0} veces. La vista previa real se genera bajo demanda cuando el pipeline de imagen esta conectado.
            </Text>
            <Button mode="contained" onPress={onCloseStylePreview}>
              Cerrar
            </Button>
          </View>
        ) : null}
      </Modal>
      <Dialog visible={Boolean(confirmAction)} onDismiss={onClearConfirm}>
        <Dialog.Title>{confirmTitle(confirmAction)}</Dialog.Title>
        <Dialog.Content>
          <Text variant="bodyMedium">{confirmBody(confirmAction, pageName)}</Text>
          {requiresName ? (
            <TextInput
              mode="outlined"
              label={`Escribe ${pageName}`}
              value={confirmText}
              onChangeText={onConfirmText}
              style={styles.confirmInput}
            />
          ) : null}
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onClearConfirm}>Cancelar</Button>
          <Button
            disabled={!canConfirm}
            onPress={
              confirmAction === 'restore-page'
                ? onRestorePage
                : confirmAction === 'disconnect-page'
                  ? onDisconnectPage
                  : confirmAction === 'delete-page'
                    ? onDeletePage
                    : confirmAction === 'delete-account'
                      ? onDeleteAccount
                      : onClearConfirm
            }
            textColor={theme.colors.error}
          >
            Confirmar
          </Button>
        </Dialog.Actions>
      </Dialog>
      <Snackbar
        action={
          onUndo
            ? {
                label: 'Deshacer',
                onPress: onUndo,
              }
            : undefined
        }
        onDismiss={onDismissNotice}
        visible={Boolean(notice)}
      >
        {notice}
      </Snackbar>
    </Portal>
  );
}

function MenuItem({
  description,
  icon,
  onPress,
  title,
}: {
  description: string;
  icon: string;
  onPress: () => void;
  title: string;
}) {
  return (
    <List.Item
      description={description}
      left={(props) => <List.Icon {...props} icon={icon} />}
      onPress={onPress}
      right={(props) => <List.Icon {...props} icon="chevron-right" />}
      title={title}
    />
  );
}

function SettingsSwitch({
  description,
  label,
  onChange,
  value,
}: {
  description: string;
  label: string;
  onChange: (value: boolean) => void;
  value: boolean;
}) {
  return (
    <View style={styles.switchRow}>
      <View style={styles.flex}>
        <Text variant="titleSmall">{label}</Text>
        <Text variant="bodySmall">{description}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

function CounterRow({
  label,
  max,
  min,
  onChange,
  step = 1,
  value,
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step?: number;
  value: number;
}) {
  return (
    <View style={styles.counterRow}>
      <Text variant="titleSmall">{label}</Text>
      <View style={styles.counter}>
        <Button compact mode="outlined" onPress={() => onChange(Math.max(min, value - step))}>
          Menos
        </Button>
        <Text variant="titleMedium">{value}</Text>
        <Button compact mode="contained" onPress={() => onChange(Math.min(max, value + step))}>
          Mas
        </Button>
      </View>
    </View>
  );
}

function InfoRow({ icon, label, value }: { icon: MaterialIconName; label: string; value: string }) {
  const theme = useTheme();

  return (
    <View style={styles.infoRow}>
      <MaterialCommunityIcons color={theme.colors.onSurfaceVariant} name={icon} size={22} />
      <View style={styles.flex}>
        <Text variant="labelMedium">{label}</Text>
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
          {value}
        </Text>
      </View>
    </View>
  );
}

function sectionTitle(section: SettingsSection): string {
  return (
    {
      about: 'Acerca de',
      appearance: 'Apariencia',
      brand: 'Marca e identidad',
      gallery: 'Galeria',
      generation: 'Generacion',
      'global-advanced': 'Avanzado',
      'global-notifications': 'Notificaciones',
      integrations: 'Integraciones',
      'page-advanced': 'Avanzado',
      'page-notifications': 'Notificaciones',
      privacy: 'Privacidad',
      profile: 'Perfil',
      scheduling: 'Programacion',
      styles: 'Estilos',
    } satisfies Record<SettingsSection, string>
  )[section];
}

function sectionIcon(section: SettingsSection): string {
  return (
    {
      about: 'information-outline',
      appearance: 'theme-light-dark',
      brand: 'palette-outline',
      gallery: 'image-multiple-outline',
      generation: 'auto-fix',
      'global-advanced': 'test-tube',
      'global-notifications': 'bell-cog-outline',
      integrations: 'connection',
      'page-advanced': 'cog-outline',
      'page-notifications': 'bell-outline',
      privacy: 'shield-lock-outline',
      profile: 'account-circle-outline',
      scheduling: 'calendar-clock',
      styles: 'image-filter-vintage',
    } satisfies Record<SettingsSection, string>
  )[section];
}

function validateBrand(
  draft: PageSettings,
  hashtagsText: string,
  colorsText: string,
): { colors?: string; hashtags?: string } {
  const hashtags = listFromText(hashtagsText);
  const colors = listFromText(colorsText);

  return {
    colors: colors.some((color) => !/^#[0-9a-fA-F]{6}$/.test(color))
      ? 'Cada color debe ser HEX, por ejemplo #1B3A57.'
      : undefined,
    hashtags: hashtags.some((hashtag) => !/^#[^\s#]{1,39}$/.test(hashtag))
      ? 'Cada hashtag debe iniciar con # y no tener espacios.'
      : hashtags.length > 30
        ? 'Usa maximo 30 hashtags.'
        : draft.brand.signature.length > 100
          ? 'La firma debe medir maximo 100 caracteres.'
          : undefined,
  };
}

function validateKeywords(value: string): string | undefined {
  const keywords = listFromText(value);

  if (keywords.length > 20) {
    return 'Usa maximo 20 palabras.';
  }

  if (keywords.some((keyword) => keyword.length > 30)) {
    return 'Cada palabra debe medir maximo 30 caracteres.';
  }

  return undefined;
}

function validateBusinessHours(start: string, end: string): string | undefined {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end)) {
    return 'Usa formato HH:MM.';
  }

  if (minutesFromTime(end) - minutesFromTime(start) < 60) {
    return 'La ventana debe durar al menos 1 hora.';
  }

  return undefined;
}

function listFromText(value: string): string[] {
  return [...new Set(value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean))];
}

function minutesFromTime(value: string): number {
  const [hours = '0', minutes = '0'] = value.split(':');
  return Number(hours) * 60 + Number(minutes);
}

function normalizeSearch(value: string): string {
  return value
    .toLocaleLowerCase('es-MX')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function groupStyles(): Array<[string, typeof STYLE_CATALOG_ITEMS]> {
  const groups = new Map<string, typeof STYLE_CATALOG_ITEMS>();

  STYLE_CATALOG_ITEMS.forEach((style) => {
    groups.set(style.group, [...(groups.get(style.group) ?? []), style]);
  });

  return [...groups.entries()];
}

function isPageMetaDisconnected(page: Page): boolean {
  return Boolean(page.metaDisconnectedAt || page.hasPageAccessToken === false);
}

function confirmTitle(action: ConfirmAction | undefined): string {
  if (action === 'restore-page') {
    return 'Restaurar defaults';
  }

  if (action === 'disconnect-page') {
    return 'Desconectar pagina';
  }

  if (action === 'delete-page') {
    return 'Eliminar pagina';
  }

  if (action === 'delete-account') {
    return 'Eliminar cuenta';
  }

  return 'Confirmar accion';
}

function confirmBody(
  action: ConfirmAction | undefined,
  pageName: string,
): string {
  if (action === 'restore-page') {
    return 'Se reemplazaran los ajustes de esta pagina con los valores de fabrica.';
  }

  if (action === 'disconnect-page') {
    return 'Se eliminara el token de publicacion en Cadencia. No se borra la pagina real de Facebook.';
  }

  if (action === 'delete-page') {
    return `Esto borrara los datos de ${pageName} dentro de Cadencia. Escribe el nombre para habilitar la accion.`;
  }

  if (action === 'delete-account') {
    return `Esto borrara la cuenta y todas sus paginas en Cadencia. Escribe ${pageName} para habilitar la accion.`;
  }

  return 'Confirma para continuar.';
}

const styles = StyleSheet.create({
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  codeBlock: {
    fontFamily: 'monospace',
  },
  confirmInput: {
    marginTop: spacing.md,
  },
  counter: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  counterRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  detailContent: {
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  flex: {
    flex: 1,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  headerTitle: {
    flex: 1,
    gap: spacing.xxs,
  },
  infoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  integrationCard: {
    alignItems: 'center',
    borderRadius: radius.small,
    gap: spacing.xs,
    padding: spacing.lg,
  },
  modal: {
    borderRadius: radius.medium,
    margin: spacing.md,
    maxHeight: '88%',
    padding: spacing.md,
  },
  notice: {
    borderRadius: radius.small,
    padding: spacing.md,
  },
  previewImage: {
    aspectRatio: 4 / 3,
    borderRadius: radius.small,
    width: '100%',
  },
  primaryButton: {
    marginTop: spacing.sm,
  },
  section: {
    gap: spacing.md,
  },
  settingBlock: {
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  switchRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  timeField: {
    flex: 1,
  },
  timeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
});
