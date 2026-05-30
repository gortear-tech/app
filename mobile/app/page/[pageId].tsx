import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Button,
  Chip,
  FAB,
  Modal,
  Portal,
  ProgressBar,
  SegmentedButtons,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';
import {
  DEFAULT_GALLERY_TAXONOMY,
  batchPhaseLabel,
  batchProgress,
  isActiveBatchStatus,
  type Batch,
  type CalendarItem,
  type Page,
  type PageSettings,
  type Photo,
  type StyleHistoryEntry,
} from '@cadencia/shared';
import { MinimalCalendarStrip } from '../../src/components/MinimalCalendarStrip';
import { PageSettingsPanel } from '../../src/components/PageSettingsPanel';
import { PhotoTile } from '../../src/components/PhotoTile';
import { Screen } from '../../src/components/Screen';
import { openMetaLogin } from '../../src/auth';
import {
  deletePageFromCadencia,
  describeApiError,
  disconnectPageMeta,
  disconnectMeta,
  fetchMetaStatus,
  generatePhotoContext,
  type MetaConnectionStatus,
  updatePhotoMetadata,
  updatePageSettings,
  uploadPagePhotos,
  type PhotoUpload,
} from '../../src/api';
import { loadPageBundle, type DataSource } from '../../src/data/live';
import { radius, spacing } from '../../src/theme';

type Tab = 'gallery' | 'create' | 'settings';
type GalleryStatusFilter = 'active' | 'archived' | 'trashed';
type GalleryQualityFilter = 'all' | 'high' | 'low';
type GalleryStackFilter = 'primary' | 'all';
type MaterialIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

type PageState = {
  loading: boolean;
  page?: Page;
  batches: Batch[];
  photos: Photo[];
  calendar: CalendarItem[];
  styleHistory: StyleHistoryEntry[];
  source: DataSource;
  notice?: string;
};

export default function PageHomeScreen() {
  const { pageId } = useLocalSearchParams<{ pageId: string }>();
  const theme = useTheme();
  const [tab, setTab] = useState<Tab>('gallery');
  const [galleryQuery, setGalleryQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [qualityFilter, setQualityFilter] = useState<GalleryQualityFilter>('all');
  const [statusFilter, setStatusFilter] = useState<GalleryStatusFilter>('active');
  const [stackFilter, setStackFilter] = useState<GalleryStackFilter>('primary');
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [contextPhoto, setContextPhoto] = useState<Photo | undefined>();
  const [photoNameValue, setPhotoNameValue] = useState('');
  const [photoCategoryValue, setPhotoCategoryValue] = useState('');
  const [photoTagsValue, setPhotoTagsValue] = useState('');
  const [contextValue, setContextValue] = useState('');
  const [contextGenerating, setContextGenerating] = useState(false);
  const [contextSaving, setContextSaving] = useState(false);
  const [expandedBatchId, setExpandedBatchId] = useState<string | undefined>();
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [metaStatus, setMetaStatus] = useState<MetaConnectionStatus | undefined>();
  const [checkingSession, setCheckingSession] = useState(true);
  const [metaConnecting, setMetaConnecting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [state, setState] = useState<PageState>({
    batches: [],
    loading: true,
    photos: [],
    calendar: [],
    styleHistory: [],
    source: 'demo',
  });

  useEffect(() => {
    let active = true;

    if (!pageId) {
      return undefined;
    }

    setState((current) => ({ ...current, loading: true }));
    setSelectedPhotoIds([]);

    loadPageBundle(pageId).then((bundle) => {
      if (!active) {
        return;
      }

      setState({
        loading: false,
        batches: bundle.batches,
        page: bundle.page,
        photos: bundle.photos,
        calendar: bundle.calendar,
        styleHistory: bundle.styleHistory,
        source: bundle.source,
        notice: bundle.notice,
      });
    });

    return () => {
      active = false;
    };
  }, [pageId]);

  useEffect(() => {
    let active = true;

    setCheckingSession(true);
    fetchMetaStatus()
      .then((result) => {
        if (active) {
          setMetaStatus(result);
        }
      })
      .catch(() => {
        if (active) {
          setMetaStatus(undefined);
        }
      })
      .finally(() => {
        if (active) {
          setCheckingSession(false);
        }
      });

    return () => {
      active = false;
    };
  }, [pageId]);

  const reconnectMeta = async () => {
    setMetaConnecting(true);

    try {
      await openMetaLogin();
    } catch (error) {
      setState((current) => ({
        ...current,
        notice: describeApiError(error),
      }));
    } finally {
      setMetaConnecting(false);
    }
  };

  const stackSizes = useMemo(() => {
    const counts = new Map<string, number>();

    state.photos.forEach((photo) => {
      if (photo.stackId) {
        counts.set(photo.stackId, (counts.get(photo.stackId) ?? 0) + 1);
      }
    });

    return counts;
  }, [state.photos]);

  if (state.loading && !state.page) {
    return (
      <Screen>
        <View style={styles.loading}>
          <ActivityIndicator />
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            Cargando pagina...
          </Text>
        </View>
      </Screen>
    );
  }

  if (!state.page) {
    return (
      <Screen>
        <Text variant="headlineSmall">Pagina no encontrada</Text>
        {state.notice ? <Notice text={state.notice} /> : null}
        <Button mode="contained" onPress={() => router.replace('/pages')}>
          Volver a paginas
        </Button>
      </Screen>
    );
  }

  const page = state.page;
  const pageConnectionLabel =
    state.source !== 'meta'
      ? 'datos de muestra'
      : page.metaDisconnectedAt || page.hasPageAccessToken === false
        ? 'desconectada de Meta'
        : 'conectada a Meta';

  if (state.source === 'meta' && checkingSession) {
    return (
      <Screen>
        <View style={styles.loading}>
          <ActivityIndicator />
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            Revisando sesion de Meta...
          </Text>
        </View>
      </Screen>
    );
  }

  if (state.source === 'meta' && (!metaStatus || !metaStatus.ok)) {
    return (
      <Screen>
        <View style={styles.sessionGate}>
          <View style={[styles.mark, { backgroundColor: theme.colors.primaryContainer }]}>
            <MaterialCommunityIcons color={theme.colors.primary} name="facebook" size={42} />
          </View>
          <Text variant="headlineSmall" style={{ textAlign: 'center' }}>
            Inicia sesion con Facebook
          </Text>
          <Text
            variant="bodyMedium"
            style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}
          >
            Cadencia necesita una sesion activa para abrir y administrar {page.name}.
          </Text>
          {state.notice ? <Notice text={state.notice} /> : null}
          <Button
            icon="facebook"
            loading={metaConnecting}
            mode="contained"
            onPress={reconnectMeta}
            style={styles.primaryButton}
          >
            Continuar con Facebook
          </Button>
          <Button mode="text" onPress={() => router.replace('/')}>
            Volver al inicio
          </Button>
        </View>
      </Screen>
    );
  }

  const taxonomy = page.settings.gallery?.taxonomy?.length
    ? page.settings.gallery.taxonomy
    : [...DEFAULT_GALLERY_TAXONOMY];
  const galleryTags = uniqueClean(state.photos.flatMap((photo) => photo.tags)).slice(0, 12);
  const activePhotoCount = state.photos.filter((photo) => photo.status === 'active').length;
  const archivedPhotoCount = state.photos.filter((photo) => photo.status === 'archived').length;
  const trashedPhotoCount = state.photos.filter((photo) => photo.status === 'trashed').length;
  const lowQualityCount = state.photos.filter((photo) => photo.lowQuality).length;
  const favoriteCount = state.photos.filter((photo) => photo.isFavorite).length;
  const togglePhoto = (photoId: string) => {
    setSelectedPhotoIds((current) =>
      current.includes(photoId) ? current.filter((id) => id !== photoId) : [...current, photoId],
    );
  };
  const selectingPhotos = selectedPhotoIds.length > 0;
  const draftBatches = state.batches.filter((batch) => batch.status === 'draft');
  const activeBatches = state.batches.filter((batch) => isActiveBatchStatus(batch.status));
  const filteredPhotos = filterGalleryPhotos(state.photos, {
    category: categoryFilter,
    favoriteOnly,
    quality: qualityFilter,
    query: galleryQuery,
    stack: stackFilter,
    status: statusFilter,
  });
  const timelineSections = groupPhotosByMonth(filteredPhotos);
  const openPhotoContext = (photo: Photo) => {
    setContextPhoto(photo);
    setPhotoNameValue(photo.name);
    setPhotoCategoryValue(photo.category);
    setPhotoTagsValue(photo.tags.join(', '));
    setContextValue(photo.description ?? photo.context ?? '');
  };
  const closePhotoContext = () => {
    if (contextSaving || contextGenerating) {
      return;
    }

    setContextPhoto(undefined);
    setPhotoNameValue('');
    setPhotoCategoryValue('');
    setPhotoTagsValue('');
    setContextValue('');
  };
  const replacePhoto = (updatedPhoto: Photo) => {
    setState((current) => ({
      ...current,
      photos: current.photos.map((photo) => (photo.id === updatedPhoto.id ? updatedPhoto : photo)),
    }));
    setContextPhoto((current) => (current?.id === updatedPhoto.id ? updatedPhoto : current));
  };
  const savePhotoContext = async () => {
    if (!contextPhoto || contextSaving) {
      return;
    }

    const name = photoNameValue.trim() || contextPhoto.name;
    const description = contextValue.trim();
    const tags = uniqueClean(photoTagsValue.split(/[,;\n]/)).slice(0, 12);
    const category = taxonomy.includes(photoCategoryValue) ? photoCategoryValue : 'otro';
    setContextSaving(true);

    try {
      const updatedPhoto =
        state.source === 'meta'
          ? await updatePhotoMetadata(page.id, contextPhoto.id, {
              category,
              description: description.length > 0 ? description : null,
              name,
              tags,
            })
          : {
              ...contextPhoto,
              category,
              context: description.length > 0 ? description : null,
              contextSource: description.length > 0 ? ('manual' as const) : null,
              description: description.length > 0 ? description : null,
              name,
              nameSource: 'manual' as const,
              tags,
            };
      replacePhoto(updatedPhoto);
      setState((current) => ({
        ...current,
        notice: 'Metadata guardada en la foto.',
      }));
      setContextPhoto(undefined);
      setPhotoNameValue('');
      setPhotoCategoryValue('');
      setPhotoTagsValue('');
      setContextValue('');
    } catch (error) {
      setState((current) => ({
        ...current,
        notice: describeApiError(error),
      }));
    } finally {
      setContextSaving(false);
    }
  };
  const signOut = async () => {
    if (signingOut) {
      return;
    }

    setSigningOut(true);

    try {
      await disconnectMeta();
      router.replace('/');
    } catch (error) {
      setState((current) => ({
        ...current,
        notice: describeApiError(error),
      }));
    } finally {
      setSigningOut(false);
    }
  };
  const disconnectPage = async () => {
    try {
      const updatedPage =
        state.source === 'meta'
          ? await disconnectPageMeta(page.id)
          : {
              ...page,
            };

      setState((current) => ({
        ...current,
        page: updatedPage,
        notice: 'Pagina desconectada de Cadencia.',
      }));
      return true;
    } catch (error) {
      setState((current) => ({
        ...current,
        notice: describeApiError(error),
      }));
      return false;
    }
  };
  const deletePage = async () => {
    try {
      if (state.source === 'meta') {
        await deletePageFromCadencia(page.id);
      }

      router.replace('/pages');
      return true;
    } catch (error) {
      setState((current) => ({
        ...current,
        notice: describeApiError(error),
      }));
      return false;
    }
  };
  const saveSettings = async (settings: PageSettings, successMessage: string) => {
    setSettingsSaving(true);

    try {
      const updatedPage = await updatePageSettings(page.id, settings);
      setState((current) => ({
        ...current,
        page: updatedPage,
        notice: successMessage,
      }));
      return true;
    } catch (error) {
      setState((current) => ({
        ...current,
        notice: describeApiError(error),
      }));
      return false;
    } finally {
      setSettingsSaving(false);
    }
  };
  const generateContextForPhoto = async () => {
    if (!contextPhoto || contextGenerating) {
      return;
    }

    setContextGenerating(true);

    try {
      const updatedPhoto =
        state.source === 'meta'
          ? await generatePhotoContext(page.id, contextPhoto.id)
          : {
              ...contextPhoto,
              context: 'Descripcion automatica simulada para esta foto de muestra.',
              description: 'Descripcion automatica simulada para esta foto de muestra.',
              contextSource: 'ai' as const,
            };
      replacePhoto(updatedPhoto);
      setContextValue(updatedPhoto.description ?? updatedPhoto.context ?? '');
      setPhotoNameValue(updatedPhoto.name);
      setPhotoCategoryValue(updatedPhoto.category);
      setPhotoTagsValue(updatedPhoto.tags.join(', '));
      setState((current) => ({
        ...current,
        notice: 'Contexto generado con IA. Puedes ajustarlo si hace falta.',
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        notice: describeApiError(error),
      }));
    } finally {
      setContextGenerating(false);
    }
  };
  const uploadPhotos = async () => {
    if (!pageId || uploading) {
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      base64: true,
      mediaTypes: ['images'],
      quality: 0.88,
      selectionLimit: 10,
    });

    if (result.canceled) {
      return;
    }

    const uploads = result.assets.flatMap<PhotoUpload>((asset) => {
      const mimeType = normalizeMimeType(asset.mimeType);

      if (!asset.base64 || !mimeType) {
        return [];
      }

      return [
        {
          base64: asset.base64,
          fileName: asset.fileName ?? undefined,
          mimeType,
        },
      ];
    });

    if (uploads.length === 0) {
      setState((current) => ({
        ...current,
        notice: 'No pude leer esas imagenes. Prueba con JPG, PNG o WEBP.',
      }));
      return;
    }

    setUploading(true);

    try {
      const uploadResult = await uploadPagePhotos(page.id, uploads);
      setState((current) => ({
        ...current,
        photos: uploadResult.photos,
        loading: false,
        notice: uploadNotice(uploadResult.uploadedCount, uploadResult.duplicateCount),
      }));
      setTab('gallery');
    } catch (error) {
      setState((current) => ({
        ...current,
        notice: describeApiError(error),
      }));
    } finally {
      setUploading(false);
    }
  };
  const updatePhotoQuick = async (
    photo: Photo,
    update: Partial<
      Pick<Photo, 'category' | 'description' | 'isFavorite' | 'name' | 'status' | 'tags'>
    >,
    notice: string,
  ) => {
    try {
      const updatedPhoto =
        state.source === 'meta'
          ? await updatePhotoMetadata(page.id, photo.id, update)
          : applyLocalPhotoUpdate(photo, update);
      replacePhoto(updatedPhoto);
      setState((current) => ({
        ...current,
        notice,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        notice: describeApiError(error),
      }));
    }
  };
  const applyBulkPhotoUpdate = async (
    update: Partial<Pick<Photo, 'isFavorite' | 'status'>>,
    notice: string,
  ) => {
    const selectedPhotos = state.photos.filter((photo) => selectedPhotoIds.includes(photo.id));

    if (selectedPhotos.length === 0) {
      return;
    }

    try {
      const updatedPhotos =
        state.source === 'meta'
          ? await Promise.all(
              selectedPhotos.map((photo) => updatePhotoMetadata(page.id, photo.id, update)),
            )
          : selectedPhotos.map((photo) => applyLocalPhotoUpdate(photo, update));
      const updatedById = new Map(updatedPhotos.map((photo) => [photo.id, photo]));

      setState((current) => ({
        ...current,
        photos: current.photos.map((photo) => updatedById.get(photo.id) ?? photo),
        notice,
      }));
      setSelectedPhotoIds([]);
    } catch (error) {
      setState((current) => ({
        ...current,
        notice: describeApiError(error),
      }));
    }
  };

  return (
    <Screen style={styles.screen}>
      <View>
        <Image source={{ uri: page.coverUrl }} style={styles.cover} contentFit="cover" />
        <View style={styles.headerRow}>
          <Image
            source={{ uri: page.profileUrl }}
            style={[styles.avatar, { borderColor: theme.colors.surface }]}
            contentFit="cover"
          />
          <View style={styles.headerText}>
            <Text variant="headlineSmall">{page.name}</Text>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              {page.category} - {pageConnectionLabel}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cambiar pagina activa"
            onPress={() => router.push('/pages')}
            style={[styles.iconButton, { backgroundColor: theme.colors.surfaceVariant }]}
          >
            <MaterialCommunityIcons
              color={theme.colors.onSurface}
              name="swap-horizontal"
              size={24}
            />
          </Pressable>
        </View>
      </View>

      {state.notice ? <Notice text={state.notice} /> : null}

      {metaStatus && !metaStatus.ok ? (
        <View style={[styles.notice, { backgroundColor: theme.colors.errorContainer }]}>
          <Text variant="bodyMedium" style={{ color: theme.colors.onErrorContainer }}>
            La sesion de Meta necesita renovarse para sincronizar paginas y publicar.
          </Text>
          <Button
            icon="facebook"
            loading={metaConnecting}
            mode="contained-tonal"
            onPress={reconnectMeta}
          >
            Iniciar sesion con Facebook
          </Button>
        </View>
      ) : null}

      {draftBatches.length > 0 ? (
        <View style={[styles.resumeBanner, { backgroundColor: theme.colors.primaryContainer }]}>
          <View style={styles.settingText}>
            <Text variant="titleMedium" style={{ color: theme.colors.onPrimaryContainer }}>
              Tienes un borrador sin terminar
            </Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onPrimaryContainer }}>
              {draftBatches[0]?.selectedPhotoIds.length ?? 0} fotos · guardado automaticamente
            </Text>
          </View>
          <Button
            compact
            icon="arrow-right"
            mode="contained"
            onPress={() =>
              router.push({
                pathname: '/create/[pageId]',
                params: {
                  draftId: draftBatches[0]?.id,
                  pageId: page.id,
                },
              })
            }
          >
            Continuar
          </Button>
        </View>
      ) : null}

      {activeBatches.length > 0 ? (
        <View style={styles.section}>
          <View style={styles.rowBetween}>
            <Text variant="titleLarge">Lotes activos ({activeBatches.length})</Text>
            <Chip compact icon="timeline-clock-outline">
              En curso
            </Chip>
          </View>
          <View style={styles.activeBatchList}>
            {activeBatches.map((batch) => (
              <View key={batch.id} style={styles.activeBatchItem}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    setExpandedBatchId((current) => (current === batch.id ? undefined : batch.id))
                  }
                  style={[styles.activeBatchRow, { borderColor: theme.colors.outline }]}
                >
                  <View style={[styles.batchColor, { backgroundColor: batch.accentColor }]} />
                  <View style={styles.settingText}>
                    <Text variant="titleSmall">{batch.shortLabel}</Text>
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                      {batchPhaseLabel(batch.status)} · {Math.round(batchProgress(batch) * 100)}%
                    </Text>
                  </View>
                  <Chip compact>{batch.selectedPhotoIds.length * batch.variantsPerPhoto}</Chip>
                </Pressable>
                {expandedBatchId === batch.id ? (
                  <View
                    style={[
                      styles.activeBatchDetail,
                      { backgroundColor: theme.colors.surfaceVariant },
                    ]}
                  >
                    <ProgressBar progress={batchProgress(batch)} />
                    <View style={styles.infoList}>
                      <InfoRow
                        icon="image-multiple-outline"
                        label="Fotos"
                        value={String(batch.selectedPhotoIds.length)}
                      />
                      <InfoRow
                        icon="shape-outline"
                        label="Variantes"
                        value={String(batch.selectedPhotoIds.length * batch.variantsPerPhoto)}
                      />
                      <InfoRow
                        icon="flash-outline"
                        label="Modo"
                        value={batch.skipReview ? 'Rapido' : 'Revision manual'}
                      />
                    </View>
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text variant="titleLarge">Proximas publicaciones</Text>
        <MinimalCalendarStrip items={state.calendar} />
      </View>

      <SegmentedButtons
        value={tab}
        onValueChange={(value) => setTab(value as Tab)}
        buttons={[
          { value: 'gallery', label: 'Galeria', icon: 'image-multiple' },
          { value: 'create', label: 'Crear', icon: 'plus-box' },
          { value: 'settings', label: 'Ajustes', icon: 'cog' },
        ]}
      />

      {tab === 'gallery' ? (
        <View style={styles.section}>
          <View style={styles.galleryHeader}>
            <View>
              <Text variant="titleLarge">Galeria</Text>
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {activePhotoCount} activas - {favoriteCount} favoritas - {lowQualityCount} por
                revisar
              </Text>
            </View>
            <Chip compact icon={selectingPhotos ? 'check-circle' : 'image-multiple'}>
              {selectingPhotos
                ? `${selectedPhotoIds.length} sel.`
                : `${filteredPhotos.length} visibles`}
            </Chip>
          </View>
          <TextInput
            mode="outlined"
            dense
            left={<TextInput.Icon icon="magnify" />}
            placeholder="Buscar por nombre, tag o descripcion"
            value={galleryQuery}
            onChangeText={setGalleryQuery}
            right={
              galleryQuery ? (
                <TextInput.Icon icon="close" onPress={() => setGalleryQuery('')} />
              ) : undefined
            }
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
          >
            <Chip selected={categoryFilter === 'all'} onPress={() => setCategoryFilter('all')}>
              Todas
            </Chip>
            {taxonomy.map((category) => (
              <Chip
                key={category}
                selected={categoryFilter === category}
                onPress={() => setCategoryFilter(category)}
              >
                {categoryLabel(category)}
              </Chip>
            ))}
          </ScrollView>
          <SegmentedButtons
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as GalleryStatusFilter)}
            buttons={[
              { value: 'active', label: `Grid ${activePhotoCount}`, icon: 'view-grid-outline' },
              {
                value: 'archived',
                label: `Archivo ${archivedPhotoCount}`,
                icon: 'archive-outline',
              },
              {
                value: 'trashed',
                label: `Papelera ${trashedPhotoCount}`,
                icon: 'trash-can-outline',
              },
            ]}
          />
          <View style={styles.chips}>
            <Chip
              icon={favoriteOnly ? 'star' : 'star-outline'}
              selected={favoriteOnly}
              onPress={() => setFavoriteOnly((value) => !value)}
            >
              Favoritas
            </Chip>
            <Chip selected={qualityFilter === 'all'} onPress={() => setQualityFilter('all')}>
              Calidad
            </Chip>
            <Chip
              icon="check-decagram-outline"
              selected={qualityFilter === 'high'}
              onPress={() => setQualityFilter(qualityFilter === 'high' ? 'all' : 'high')}
            >
              Alta
            </Chip>
            <Chip
              icon="alert-outline"
              selected={qualityFilter === 'low'}
              onPress={() => setQualityFilter(qualityFilter === 'low' ? 'all' : 'low')}
            >
              Baja
            </Chip>
            <Chip
              icon={
                stackFilter === 'primary' ? 'image-filter-center-focus' : 'image-multiple-outline'
              }
              selected={stackFilter === 'primary'}
              onPress={() => setStackFilter(stackFilter === 'primary' ? 'all' : 'primary')}
            >
              Principales
            </Chip>
          </View>
          {galleryTags.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
            >
              {galleryTags.map((tag) => (
                <Chip key={tag} compact onPress={() => setGalleryQuery(tag)}>
                  {tag}
                </Chip>
              ))}
            </ScrollView>
          ) : null}
          {state.photos.length === 0 ? (
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              La galeria de Cadencia todavia esta vacia. Las fotos apareceran aqui cuando las subas
              desde la app.
            </Text>
          ) : filteredPhotos.length === 0 ? (
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              No hay fotos en este filtro.
            </Text>
          ) : (
            <View style={styles.timeline}>
              {timelineSections.map((section) => (
                <View key={section.title} style={styles.timelineSection}>
                  <Text variant="titleSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    {section.title}
                  </Text>
                  <FlatList
                    data={section.photos}
                    keyExtractor={(item) => item.id}
                    numColumns={3}
                    scrollEnabled={false}
                    columnWrapperStyle={styles.gridRow}
                    renderItem={({ item }) => (
                      <View style={styles.gridItem}>
                        <PhotoTile
                          photo={item}
                          selected={selectedPhotoIds.includes(item.id)}
                          stackSize={item.stackId ? (stackSizes.get(item.stackId) ?? 1) : 1}
                          onLongPress={() => togglePhoto(item.id)}
                          onPress={() =>
                            selectingPhotos ? togglePhoto(item.id) : openPhotoContext(item)
                          }
                        />
                      </View>
                    )}
                  />
                </View>
              ))}
            </View>
          )}
          {selectedPhotoIds.length > 0 ? (
            <View style={[styles.bulkBar, { backgroundColor: theme.colors.surfaceVariant }]}>
              <Button
                compact
                icon="plus-box"
                mode="contained"
                onPress={() =>
                  router.push({
                    pathname: '/create/[pageId]',
                    params: {
                      pageId: page.id,
                      photoIds: selectedPhotoIds.join(','),
                    },
                  })
                }
              >
                Publicar
              </Button>
              <Button
                compact
                icon="star"
                onPress={() =>
                  applyBulkPhotoUpdate({ isFavorite: true }, 'Fotos marcadas como favoritas.')
                }
              >
                Favorita
              </Button>
              <Button
                compact
                icon="archive-outline"
                onPress={() => applyBulkPhotoUpdate({ status: 'archived' }, 'Fotos archivadas.')}
              >
                Archivar
              </Button>
              <Button
                compact
                icon="trash-can-outline"
                onPress={() =>
                  applyBulkPhotoUpdate({ status: 'trashed' }, 'Fotos movidas a papelera.')
                }
              >
                Papelera
              </Button>
            </View>
          ) : null}
          <FAB
            accessibilityLabel="Subir fotos"
            icon="plus"
            label={uploading ? 'Subiendo' : 'Subir'}
            loading={uploading}
            onPress={uploadPhotos}
            style={styles.fab}
          />
        </View>
      ) : null}

      {tab === 'create' ? (
        <View style={styles.section}>
          <Text variant="titleLarge">Crear publicaciones</Text>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            El flujo solo usa fotos subidas a Cadencia para esta pagina. No toma imagenes de
            publicaciones anteriores de Facebook.
          </Text>
          {state.photos.length === 0 ? (
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              Primero hay que subir fotos a la galeria de esta pagina.
            </Text>
          ) : null}
          <Button
            disabled={state.photos.length === 0}
            mode="contained"
            onPress={() =>
              router.push({
                pathname: '/create/[pageId]',
                params: { pageId: page.id },
              })
            }
            style={styles.primaryButton}
          >
            Iniciar flujo
          </Button>
        </View>
      ) : null}

      {tab === 'settings' ? (
        <PageSettingsPanel
          metaStatus={metaStatus}
          onChangePage={() => router.push('/pages')}
          onDeletePage={deletePage}
          onDisconnectPage={disconnectPage}
          onReconnectMeta={reconnectMeta}
          onSavePageSettings={saveSettings}
          onSignOut={signOut}
          page={page}
          photos={state.photos}
          settingsSaving={settingsSaving}
          signingOut={signingOut}
          source={state.source}
          styleHistory={state.styleHistory}
        />
      ) : null}

      <Portal>
        <Modal
          contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.surface }]}
          onDismiss={closePhotoContext}
          visible={Boolean(contextPhoto)}
        >
          {contextPhoto ? (
            <ScrollView
              contentContainerStyle={styles.modalScroll}
              showsVerticalScrollIndicator={false}
            >
              <Image
                source={{ uri: contextPhoto.thumbnailUrl }}
                style={styles.modalImage}
                contentFit="cover"
              />
              <View style={styles.rowBetween}>
                <View style={styles.settingText}>
                  <Text variant="titleMedium">Detalle de foto</Text>
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    {formatPhotoDate(contextPhoto.takenAt)} - {formatOrigin(contextPhoto.origin)}
                  </Text>
                </View>
                <Chip compact icon={contextPhoto.nameSource === 'ai' ? 'auto-fix' : 'pencil'}>
                  {contextPhoto.nameSource === 'ai' ? 'IA' : 'Manual'}
                </Chip>
              </View>
              <TextInput
                mode="outlined"
                label="Nombre"
                value={photoNameValue}
                onChangeText={setPhotoNameValue}
              />
              <TextInput
                mode="outlined"
                multiline
                label="Descripcion"
                value={contextValue}
                onChangeText={setContextValue}
              />
              <View style={styles.chips}>
                {taxonomy.map((category) => (
                  <Chip
                    key={category}
                    compact
                    selected={photoCategoryValue === category}
                    onPress={() => setPhotoCategoryValue(category)}
                  >
                    {categoryLabel(category)}
                  </Chip>
                ))}
              </View>
              <TextInput
                mode="outlined"
                label="Etiquetas"
                value={photoTagsValue}
                onChangeText={setPhotoTagsValue}
              />
              <View style={styles.infoList}>
                <InfoRow
                  icon="image-size-select-large"
                  label="Calidad"
                  value={`${contextPhoto.lowQuality ? 'Baja' : 'Alta'} - ${formatResolution(contextPhoto.qualityScore.resolution)}`}
                />
                <InfoRow
                  icon="camera-outline"
                  label="EXIF"
                  value={String(contextPhoto.exif.device ?? 'Sin dispositivo')}
                />
                <InfoRow
                  icon="chart-timeline-variant"
                  label="Historial"
                  value={`Usada en ${contextPhoto.publicationCount ?? 0} publicaciones`}
                />
              </View>
              <View style={styles.chips}>
                <Button
                  compact
                  icon={contextPhoto.isFavorite ? 'star' : 'star-outline'}
                  mode={contextPhoto.isFavorite ? 'contained-tonal' : 'outlined'}
                  onPress={() =>
                    updatePhotoQuick(
                      contextPhoto,
                      { isFavorite: !contextPhoto.isFavorite },
                      contextPhoto.isFavorite
                        ? 'Foto quitada de favoritas.'
                        : 'Foto marcada como favorita.',
                    )
                  }
                >
                  Favorita
                </Button>
                <Button
                  compact
                  icon="image-search-outline"
                  mode="outlined"
                  onPress={() => {
                    setGalleryQuery(contextPhoto.tags[0] ?? contextPhoto.name);
                    closePhotoContext();
                  }}
                >
                  Similares
                </Button>
                <Button
                  compact
                  icon="archive-outline"
                  mode="outlined"
                  onPress={() =>
                    updatePhotoQuick(contextPhoto, { status: 'archived' }, 'Foto archivada.')
                  }
                >
                  Archivar
                </Button>
                <Button
                  compact
                  icon="trash-can-outline"
                  mode="outlined"
                  onPress={() =>
                    updatePhotoQuick(contextPhoto, { status: 'trashed' }, 'Foto movida a papelera.')
                  }
                >
                  Eliminar
                </Button>
              </View>
              <View style={styles.modalActions}>
                <Button
                  disabled={contextSaving}
                  icon="auto-fix"
                  loading={contextGenerating}
                  mode="outlined"
                  onPress={generateContextForPhoto}
                >
                  Auto IA
                </Button>
                <Button disabled={contextSaving} onPress={closePhotoContext}>
                  Cancelar
                </Button>
                <Button
                  disabled={contextGenerating}
                  loading={contextSaving}
                  mode="contained"
                  onPress={savePhotoContext}
                >
                  Guardar
                </Button>
              </View>
            </ScrollView>
          ) : null}
        </Modal>
      </Portal>
    </Screen>
  );
}

function normalizeMimeType(mimeType: string | undefined): PhotoUpload['mimeType'] | undefined {
  if (mimeType === 'image/png' || mimeType === 'image/webp' || mimeType === 'image/jpeg') {
    return mimeType;
  }

  if (mimeType === 'image/jpg') {
    return 'image/jpeg';
  }

  return undefined;
}

function uploadNotice(uploadedCount: number, duplicateCount: number): string {
  const uploadedText =
    uploadedCount === 1
      ? '1 foto nueva subida a Cadencia'
      : `${uploadedCount} fotos nuevas subidas a Cadencia`;
  const duplicateText =
    duplicateCount === 1
      ? '1 duplicada ya estaba en galeria'
      : `${duplicateCount} duplicadas ya estaban en galeria`;

  if (uploadedCount > 0 && duplicateCount > 0) {
    return `${uploadedText}; ${duplicateText}.`;
  }

  if (uploadedCount > 0) {
    return `${uploadedText}.`;
  }

  if (duplicateCount > 0) {
    return `${duplicateText}.`;
  }

  return 'No se agregaron fotos nuevas.';
}

function uniqueClean(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

type GalleryFilterInput = {
  category: string;
  favoriteOnly: boolean;
  quality: GalleryQualityFilter;
  query: string;
  stack: GalleryStackFilter;
  status: GalleryStatusFilter;
};

function filterGalleryPhotos(photos: Photo[], filters: GalleryFilterInput): Photo[] {
  const query = normalizeSearch(filters.query);

  return photos.filter((photo) => {
    if (photo.status !== filters.status) {
      return false;
    }

    if (filters.category !== 'all' && photo.category !== filters.category) {
      return false;
    }

    if (filters.favoriteOnly && !photo.isFavorite) {
      return false;
    }

    if (filters.quality === 'high' && photo.lowQuality) {
      return false;
    }

    if (filters.quality === 'low' && !photo.lowQuality) {
      return false;
    }

    if (filters.stack === 'primary' && photo.stackId && !photo.stackIsPrimary) {
      return false;
    }

    if (!query) {
      return true;
    }

    return normalizeSearch(
      [photo.name, photo.description, photo.altText, photo.category, photo.context, ...photo.tags]
        .filter(Boolean)
        .join(' '),
    ).includes(query);
  });
}

function groupPhotosByMonth(photos: Photo[]): Array<{ photos: Photo[]; title: string }> {
  const formatter = new Intl.DateTimeFormat('es-MX', {
    month: 'long',
    year: 'numeric',
  });
  const sections = new Map<string, Photo[]>();

  photos.forEach((photo) => {
    const title = capitalize(formatter.format(new Date(photo.takenAt ?? photo.createdAt)));
    sections.set(title, [...(sections.get(title) ?? []), photo]);
  });

  return [...sections.entries()].map(([title, sectionPhotos]) => ({
    photos: sectionPhotos,
    title,
  }));
}

function applyLocalPhotoUpdate(
  photo: Photo,
  update: Partial<
    Pick<Photo, 'category' | 'description' | 'isFavorite' | 'name' | 'status' | 'tags'>
  >,
): Photo {
  const nextStatus = update.status ?? photo.status;
  const nextDescription = update.description === undefined ? photo.description : update.description;

  return {
    ...photo,
    ...update,
    context: update.description === undefined ? photo.context : nextDescription,
    contextSource:
      update.description === undefined ? photo.contextSource : nextDescription ? 'manual' : null,
    description: nextDescription,
    nameSource: update.name === undefined ? photo.nameSource : 'manual',
    status: nextStatus,
    trashedAt:
      nextStatus === 'trashed'
        ? (photo.trashedAt ?? new Date().toISOString())
        : nextStatus === 'active'
          ? null
          : photo.trashedAt,
  };
}

function normalizeSearch(value: string): string {
  return value
    .toLocaleLowerCase('es-MX')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function categoryLabel(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase('es-MX') + value.slice(1);
}

function formatPhotoDate(value: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function formatOrigin(value: Photo['origin']): string {
  if (value === 'app_gallery') {
    return 'galeria app';
  }

  if (value === 'phone_gallery') {
    return 'telefono';
  }

  return 'externa';
}

function formatResolution(value: number): string {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)} MP`;
  }

  return `${Math.round(value / 1000)} kpx`;
}

function InfoRow({ icon, label, value }: { icon: MaterialIconName; label: string; value: string }) {
  const theme = useTheme();

  return (
    <View style={styles.infoRow}>
      <MaterialCommunityIcons color={theme.colors.onSurfaceVariant} name={icon} size={20} />
      <View style={styles.settingText}>
        <Text variant="labelMedium">{label}</Text>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
          {value}
        </Text>
      </View>
    </View>
  );
}

function Notice({ text }: { text: string }) {
  const theme = useTheme();

  return (
    <View style={[styles.notice, { backgroundColor: theme.colors.errorContainer }]}>
      <Text variant="bodyMedium" style={{ color: theme.colors.onErrorContainer }}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    borderRadius: radius.full,
    borderWidth: 4,
    height: 72,
    marginTop: -36,
    width: 72,
  },
  activeBatchList: {
    gap: spacing.xs,
  },
  activeBatchDetail: {
    borderBottomLeftRadius: radius.small,
    borderBottomRightRadius: radius.small,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  activeBatchItem: {
    gap: 0,
  },
  activeBatchRow: {
    alignItems: 'center',
    borderRadius: radius.small,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  batchColor: {
    borderRadius: radius.full,
    height: 14,
    width: 14,
  },
  bulkBar: {
    borderRadius: radius.small,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    padding: spacing.xs,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  cover: {
    aspectRatio: 16 / 7,
    borderRadius: radius.medium,
    width: '100%',
  },
  fab: {
    alignSelf: 'flex-end',
  },
  galleryHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  gridItem: {
    flex: 1,
    padding: spacing.xs,
  },
  gridRow: {
    marginHorizontal: -spacing.xs,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  headerText: {
    flex: 1,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: radius.full,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  infoList: {
    gap: spacing.xs,
  },
  infoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  loading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 64,
  },
  mark: {
    alignItems: 'center',
    borderRadius: 28,
    height: 96,
    justifyContent: 'center',
    width: 96,
  },
  modal: {
    borderRadius: radius.medium,
    margin: spacing.md,
    maxHeight: '88%',
    padding: spacing.md,
  },
  modalActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  modalImage: {
    borderRadius: radius.small,
    height: 280,
    width: '100%',
  },
  modalScroll: {
    gap: spacing.sm,
  },
  notice: {
    borderRadius: radius.small,
    padding: spacing.md,
  },
  primaryButton: {
    minHeight: 56,
    justifyContent: 'center',
  },
  rowBetween: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  resumeBanner: {
    alignItems: 'center',
    borderRadius: radius.small,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  screen: {
    gap: spacing.xl,
  },
  section: {
    gap: spacing.md,
  },
  sessionGate: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.lg,
    justifyContent: 'center',
  },
  settingText: {
    flex: 1,
  },
  timeField: {
    flex: 1,
  },
  timeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  timeline: {
    gap: spacing.lg,
  },
  timelineSection: {
    gap: spacing.xs,
  },
});
