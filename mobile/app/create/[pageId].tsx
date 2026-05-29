import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Appbar,
  Button,
  Chip,
  Modal,
  Portal,
  ProgressBar,
  Switch,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';
import {
  assignStylesToVariants,
  calendarItemsFromSchedule,
  isActiveBatchStatus,
  suggestSmartSchedule,
  type Batch,
  type CalendarItem,
  type Page,
  type Photo,
  type SmartScheduledVariant,
  type StyleHistoryEntry,
} from '@cadencia/shared';
import { BottomActionBar } from '../../src/components/BottomActionBar';
import { PhotoTile } from '../../src/components/PhotoTile';
import { Screen } from '../../src/components/Screen';
import { StatusBadge } from '../../src/components/StatusBadge';
import {
  archiveBatch,
  commitPublicationBatch,
  describeApiError,
  fetchSchedulingSuggestion,
  generatePhotoContext,
  saveBatchDraft,
  updatePhotoContext,
  uploadPagePhotos,
  type PhotoUpload,
} from '../../src/api';
import { loadPageBundle, type DataSource } from '../../src/data/live';
import { radius, spacing } from '../../src/theme';

type FlowStage = 'prepare' | 'generating' | 'review' | 'schedule' | 'success';
type ContextMode = 'ai' | 'manual';
type ReviewDecision = 'pending' | 'approved' | 'rejected' | 'skipped';

type FlowState = {
  batches: Batch[];
  calendar: CalendarItem[];
  loading: boolean;
  notice?: string;
  page?: Page;
  photos: Photo[];
  source: DataSource;
  styleHistory: StyleHistoryEntry[];
};

type GeneratedVariant = {
  id: string;
  imageUrl?: string;
  photoId: string;
  status: 'generating' | 'ready' | 'failed';
  style: string;
  text: string;
  variantIndex: number;
};

const phaseLabels = ['Preparar', 'Generando', 'Revisar y programar'];
const facebookTextLimit = 2200;

export default function CreateFlowScreen() {
  const { draftId, pageId, photoIds } = useLocalSearchParams<{
    draftId?: string;
    pageId: string;
    photoIds?: string;
  }>();
  const theme = useTheme();
  const [state, setState] = useState<FlowState>({
    batches: [],
    calendar: [],
    loading: true,
    photos: [],
    source: 'demo',
    styleHistory: [],
  });
  const [initializedKey, setInitializedKey] = useState('');
  const [draftIdState, setDraftIdState] = useState<string | undefined>(draftId);
  const [stage, setStage] = useState<FlowStage>('prepare');
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);
  const [variantsPerPhoto, setVariantsPerPhoto] = useState(1);
  const [skipReview, setSkipReview] = useState(false);
  const [contextMode, setContextMode] = useState<ContextMode>('ai');
  const [manualContext, setManualContext] = useState<Record<string, string>>({});
  const [readyCount, setReadyCount] = useState(0);
  const [reviewDecisions, setReviewDecisions] = useState<Record<string, ReviewDecision>>({});
  const [reviewIndex, setReviewIndex] = useState(0);
  const [variantTexts, setVariantTexts] = useState<Record<string, string>>({});
  const [editingVariantId, setEditingVariantId] = useState<string | undefined>();
  const [editingText, setEditingText] = useState('');
  const [distributionDays, setDistributionDays] = useState(1);
  const [galleryPickerOpen, setGalleryPickerOpen] = useState(false);
  const [remoteSuggestedSchedule, setRemoteSuggestedSchedule] = useState<SmartScheduledVariant[]>([]);
  const [suggestionStatus, setSuggestionStatus] = useState<'idle' | 'loading' | 'ready'>('idle');
  const [useSuggestion, setUseSuggestion] = useState(true);
  const [working, setWorking] = useState(false);
  const [successSummary, setSuccessSummary] = useState('');

  useEffect(() => {
    if (!pageId) {
      return undefined;
    }

    let active = true;
    setState((current) => ({ ...current, loading: true }));

    loadPageBundle(pageId).then((bundle) => {
      if (!active) {
        return;
      }

      setState({
        batches: bundle.batches,
        calendar: bundle.calendar,
        loading: false,
        notice: bundle.notice,
        page: bundle.page,
        photos: bundle.photos,
        source: bundle.source,
        styleHistory: bundle.styleHistory,
      });
    });

    return () => {
      active = false;
    };
  }, [pageId]);

  useEffect(() => {
    if (!state.page) {
      return;
    }

    const key = `${state.page.id}:${draftId ?? ''}:${photoIds ?? ''}:${state.photos.map((photo) => photo.id).join('|')}`;

    if (key === initializedKey) {
      return;
    }

    const draft = draftId
      ? state.batches.find((batch) => batch.id === draftId && batch.status === 'draft')
      : undefined;
    const requestedIds = photoIds ? photoIds.split(',').filter(Boolean) : [];
    const validRequestedIds = requestedIds.filter((id) => state.photos.some((photo) => photo.id === id));

    setSelectedPhotoIds(draft?.selectedPhotoIds ?? validRequestedIds);
    setVariantsPerPhoto(
      draft?.variantsPerPhoto ?? state.page.settings.generation.defaultVariantsPerPhoto,
    );
    setSkipReview(draft?.skipReview ?? state.page.settings.generation.skipReviewDefault);
    setContextMode(state.page.settings.generation.defaultContextMode);
    setManualContext(draft?.contextModeOverrides ?? {});
    setDraftIdState(draft?.id);
    setInitializedKey(key);
  }, [draftId, initializedKey, photoIds, state.batches, state.page, state.photos]);

  const selectedPhotos = useMemo(
    () => state.photos.filter((photo) => selectedPhotoIds.includes(photo.id)),
    [selectedPhotoIds, state.photos],
  );
  const activeBatchCount = state.batches.filter((batch) => isActiveBatchStatus(batch.status)).length;
  const activeLimitReached = activeBatchCount >= 3;
  const effectiveContextMode = skipReview ? 'ai' : contextMode;
  const photosWithoutContext = selectedPhotos.filter((photo) => !photo.context);
  const missingManualContext = photosWithoutContext.filter(
    (photo) => !(manualContext[photo.id] ?? '').trim(),
  );
  const totalVariants = selectedPhotoIds.length * variantsPerPhoto;

  const assignments = useMemo(() => {
    if (!state.page || selectedPhotoIds.length === 0) {
      return [];
    }

    return assignStylesToVariants({
      pageSettings: state.page.settings,
      photos: selectedPhotoIds.map((photoId) => ({ photoId, variants: variantsPerPhoto })),
      recentHistory: state.styleHistory,
    });
  }, [selectedPhotoIds, state.page, state.styleHistory, variantsPerPhoto]);

  const generatedVariants = useMemo<GeneratedVariant[]>(() => {
    return assignments.map((assignment, index) => {
      const photo = selectedPhotos.find((item) => item.id === assignment.photoId);
      const id = `${assignment.photoId}-${assignment.variantIndex + 1}`;

      return {
        id,
        imageUrl: photo?.thumbnailUrl,
        photoId: assignment.photoId,
        status: index < readyCount || stage !== 'generating' ? 'ready' : 'generating',
        style: assignment.style,
        text: variantTexts[id] ?? buildVariantText(state.page, photo, assignment.style),
        variantIndex: assignment.variantIndex,
      };
    });
  }, [assignments, readyCount, selectedPhotos, stage, state.page, variantTexts]);

  const approvedVariants = useMemo(() => {
    if (skipReview) {
      return generatedVariants;
    }

    return generatedVariants.filter((variant) => reviewDecisions[variant.id] === 'approved');
  }, [generatedVariants, reviewDecisions, skipReview]);
  const skippedVariants = generatedVariants.filter(
    (variant) => reviewDecisions[variant.id] === 'skipped',
  );
  const currentVariant = generatedVariants[reviewIndex];
  const approvedVariantIds = useMemo(
    () => approvedVariants.map((variant) => variant.id),
    [approvedVariants],
  );
  const approvedVariantKey = approvedVariantIds.join('|');
  const occupiedSlotKey = state.calendar.map((item) => item.scheduledAt).join('|');
  const suggestedDays = Math.max(
    1,
    Math.ceil(approvedVariants.length / Math.max(1, state.page?.settings.scheduling.maxPostsPerDay ?? 4)),
  );

  useEffect(() => {
    setDistributionDays(suggestedDays);
  }, [suggestedDays]);

  useEffect(() => {
    if (stage !== 'schedule' || !state.page || approvedVariantIds.length === 0) {
      setRemoteSuggestedSchedule([]);
      setSuggestionStatus('idle');
      return undefined;
    }

    let active = true;
    setSuggestionStatus('loading');

    fetchSchedulingSuggestion({
      occupiedSlots: state.calendar.map((item) => item.scheduledAt),
      pageId: state.page.id,
      variantIds: approvedVariantIds,
    })
      .then((schedule) => {
        if (active) {
          setRemoteSuggestedSchedule(schedule);
        }
      })
      .catch(() => {
        if (active) {
          setRemoteSuggestedSchedule([]);
        }
      })
      .finally(() => {
        if (active) {
          setSuggestionStatus('ready');
        }
      });

    return () => {
      active = false;
    };
  }, [approvedVariantIds, approvedVariantKey, occupiedSlotKey, stage, state.calendar, state.page]);

  const localSuggestedSchedule = state.page
    ? suggestSmartSchedule({
        businessHours: state.page.settings.scheduling.businessHours,
        history: [],
        occupiedSlots: state.calendar.map((item) => item.scheduledAt),
        scheduling: state.page.settings.scheduling,
        variantIds: approvedVariantIds,
      })
    : [];
  const manualSchedule = state.page
    ? suggestSmartSchedule({
        businessHours: state.page.settings.scheduling.businessHours,
        distributionDays,
        history: [],
        occupiedSlots: state.calendar.map((item) => item.scheduledAt),
        scheduling: state.page.settings.scheduling,
        variantIds: approvedVariantIds,
      })
    : [];
  const suggestedSchedule =
    remoteSuggestedSchedule.length === approvedVariantIds.length
      ? remoteSuggestedSchedule
      : localSuggestedSchedule;
  const selectedSchedule = useSuggestion ? suggestedSchedule : manualSchedule;
  const scheduleItems = state.page ? calendarItemsFromSchedule(state.page.id, selectedSchedule) : [];
  const phaseIndex = stage === 'prepare' ? 0 : stage === 'generating' ? 1 : 2;

  useEffect(() => {
    if (!state.page || stage !== 'prepare' || initializedKey.length === 0) {
      return undefined;
    }

    if (!draftIdState && selectedPhotoIds.length === 0 && Object.keys(manualContext).length === 0) {
      return undefined;
    }

    const timer = setTimeout(() => {
      saveBatchDraft(state.page!.id, {
        batchId: draftIdState,
        contextModeOverrides: manualContext,
        pendingUploads: [],
        selectedPhotoIds,
        skipReview,
        variantsPerPhoto,
      })
        .then((batch) => {
          setDraftIdState(batch.id);
          setState((current) => ({
            ...current,
            batches: [batch, ...current.batches.filter((item) => item.id !== batch.id)],
          }));
        })
        .catch(() => {
          setState((current) => ({
            ...current,
            notice: 'Seguire intentando guardar el borrador cuando vuelva la conexion.',
          }));
        });
    }, 500);

    return () => clearTimeout(timer);
  }, [
    draftIdState,
    initializedKey,
    manualContext,
    selectedPhotoIds,
    skipReview,
    stage,
    state.page,
    variantsPerPhoto,
  ]);

  useEffect(() => {
    if (stage !== 'generating') {
      return undefined;
    }

    const total = assignments.length;
    let current = 0;

    setReadyCount(0);
    setReviewDecisions(
      Object.fromEntries(assignments.map((assignment) => [
        `${assignment.photoId}-${assignment.variantIndex + 1}`,
        'pending',
      ])),
    );

    const timer = setInterval(() => {
      current += 1;
      setReadyCount(current);

      if (current >= total) {
        clearInterval(timer);
        setTimeout(() => {
          if (skipReview) {
            setReviewDecisions(
              Object.fromEntries(assignments.map((assignment) => [
                `${assignment.photoId}-${assignment.variantIndex + 1}`,
                'approved',
              ])),
            );
            setStage('schedule');
            setUseSuggestion(true);
          } else {
            setReviewIndex(0);
            setStage('review');
          }
        }, 400);
      }
    }, Math.max(220, Math.min(650, 2800 / Math.max(1, total))));

    return () => clearInterval(timer);
  }, [assignments, skipReview, stage]);

  useEffect(() => {
    if (
      stage === 'schedule' &&
      skipReview &&
      approvedVariants.length > 0 &&
      !working &&
      suggestionStatus === 'ready'
    ) {
      void confirmSchedule(true);
    }
  }, [approvedVariants.length, skipReview, stage, suggestionStatus, working]);

  if (state.loading && !state.page) {
    return (
      <Screen>
        <View style={styles.loading}>
          <ActivityIndicator />
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            Cargando lote...
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
          Volver
        </Button>
      </Screen>
    );
  }

  const page = state.page;
  const canGenerate =
    selectedPhotoIds.length > 0 &&
    variantsPerPhoto >= 1 &&
    variantsPerPhoto <= 10 &&
    !activeLimitReached &&
    (effectiveContextMode === 'ai' || missingManualContext.length === 0);

  async function uploadPhotos() {
    if (working) {
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      base64: state.source === 'meta',
      mediaTypes: ['images'],
      quality: 0.88,
      selectionLimit: 10,
    });

    if (result.canceled) {
      return;
    }

    setWorking(true);

    try {
      if (state.source === 'meta') {
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

        const uploadResult = await uploadPagePhotos(page.id, uploads);
        const newIds = uploadResult.photos
          .filter((photo) => !state.photos.some((current) => current.id === photo.id))
          .map((photo) => photo.id);

        setState((current) => ({
          ...current,
          notice: uploadNotice(uploadResult.uploadedCount, uploadResult.duplicateCount),
          photos: uploadResult.photos,
        }));
        setSelectedPhotoIds((current) => [...new Set([...current, ...newIds])]);
      } else {
        const createdPhotos = result.assets.map((asset, index) =>
          createLocalPhoto(page.id, asset.uri, asset.fileName, index),
        );

        setState((current) => ({
          ...current,
          notice: `${createdPhotos.length} fotos listas para este lote.`,
          photos: [...createdPhotos, ...current.photos],
        }));
        setSelectedPhotoIds((current) => [
          ...new Set([...current, ...createdPhotos.map((photo) => photo.id)]),
        ]);
      }
    } catch (error) {
      setState((current) => ({
        ...current,
        notice: describeApiError(error),
      }));
    } finally {
      setWorking(false);
    }
  }

  async function startGeneration() {
    if (!canGenerate || working) {
      return;
    }

    setWorking(true);

    try {
      if (photosWithoutContext.length > 0) {
        if (effectiveContextMode === 'manual') {
          const updatedPhotos =
            state.source === 'meta'
              ? await Promise.all(
                  photosWithoutContext.map((photo) =>
                    updatePhotoContext(page.id, photo.id, {
                      context: (manualContext[photo.id] ?? '').trim(),
                    }),
                  ),
                )
              : photosWithoutContext.map((photo) => ({
                  ...photo,
                  context: (manualContext[photo.id] ?? '').trim(),
                  contextSource: 'manual' as const,
                  description: (manualContext[photo.id] ?? '').trim(),
                }));
          replacePhotos(updatedPhotos);
        } else {
          const updatedPhotos =
            state.source === 'meta'
              ? await Promise.all(photosWithoutContext.map((photo) => generatePhotoContext(page.id, photo.id)))
              : photosWithoutContext.map((photo) => ({
                  ...photo,
                  context: `Contexto IA para ${photo.name}.`,
                  contextSource: 'ai' as const,
                  description: `Contexto IA para ${photo.name}.`,
                }));
          replacePhotos(updatedPhotos);
        }
      }

      setReadyCount(0);
      setStage('generating');
    } catch (error) {
      setState((current) => ({
        ...current,
        notice: describeApiError(error),
      }));
    } finally {
      setWorking(false);
    }
  }

  function replacePhotos(updatedPhotos: Photo[]) {
    const updatedById = new Map(updatedPhotos.map((photo) => [photo.id, photo]));

    setState((current) => ({
      ...current,
      photos: current.photos.map((photo) => updatedById.get(photo.id) ?? photo),
    }));
  }

  function setDecision(variantId: string, decision: ReviewDecision) {
    setReviewDecisions((current) => ({
      ...current,
      [variantId]: decision,
    }));

    const nextIndex = generatedVariants.findIndex((variant, index) => {
      return index > reviewIndex && reviewDecisions[variant.id] === 'pending';
    });

    setReviewIndex(nextIndex >= 0 ? nextIndex : generatedVariants.length);
  }

  function acceptRemaining() {
    Alert.alert(
      'Aceptar restantes',
      `Aceptar ${Math.max(0, generatedVariants.length - reviewIndex)} variantes sin revisarlas?`,
      [
        { style: 'cancel', text: 'Cancelar' },
        {
          onPress: () => {
            setReviewDecisions((current) => {
              const next = { ...current };

              generatedVariants.slice(reviewIndex).forEach((variant) => {
                if (next[variant.id] === 'pending' || next[variant.id] === 'skipped') {
                  next[variant.id] = 'approved';
                }
              });

              return next;
            });
            setReviewIndex(generatedVariants.length);
          },
          text: 'Aceptar',
        },
      ],
    );
  }

  function openTextEditor(variant: GeneratedVariant) {
    setEditingVariantId(variant.id);
    setEditingText(variant.text);
  }

  function saveEditedText() {
    if (!editingVariantId) {
      return;
    }

    setVariantTexts((current) => ({
      ...current,
      [editingVariantId]: editingText.slice(0, facebookTextLimit),
    }));
    setEditingVariantId(undefined);
    setEditingText('');
  }

  async function confirmSchedule(isQuickMode = false) {
    if (approvedVariants.length === 0 || working) {
      return;
    }

    setWorking(true);

    try {
      await commitPublicationBatch({
        distributionDays: useSuggestion ? suggestedDays : distributionDays,
        pageId: page.id,
        skipReview,
        variants: approvedVariants.map((variant, index) => ({
          generatedText: variant.text,
          photoId: variant.photoId,
          scheduledAt: selectedSchedule[index]?.scheduledAt ?? new Date().toISOString(),
          style: variant.style,
          variantIndex: variant.variantIndex,
        })),
        variantsPerPhoto,
      });

      if (draftIdState) {
        await archiveBatch(draftIdState, { cancelledByUser: false }).catch(() => undefined);
      }

      const first = selectedSchedule[0]?.scheduledAt;
      const last = selectedSchedule[selectedSchedule.length - 1]?.scheduledAt;
      setSuccessSummary(
        `${approvedVariants.length} publicaciones en ${useSuggestion ? suggestedDays : distributionDays} dias${
          first && last ? `, entre ${formatDate(first)} y ${formatDate(last)}` : ''
        }.`,
      );
      setStage('success');
      setState((current) => ({
        ...current,
        notice: isQuickMode ? 'Modo rapido completado: lote programado.' : undefined,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        notice: describeApiError(error),
      }));
    } finally {
      setWorking(false);
    }
  }

  function goHome() {
    router.replace({ pathname: '/page/[pageId]', params: { pageId: page.id } });
  }

  return (
    <Screen scroll={false} style={styles.shell}>
      <Appbar.Header elevated={false} style={{ backgroundColor: theme.colors.surface }}>
        <Appbar.BackAction onPress={stage === 'prepare' ? goHome : () => setStage('prepare')} />
        <Appbar.Content title={draftIdState ? 'Reanudando lote' : 'Nuevo lote'} />
        {stage === 'prepare' ? (
          <View style={styles.quickToggle}>
            <Text variant="labelMedium">Modo rapido</Text>
            <Switch value={skipReview} onValueChange={setSkipReview} />
          </View>
        ) : null}
      </Appbar.Header>
      <PhaseProgress activeIndex={phaseIndex} />

      {state.notice ? <Notice text={state.notice} /> : null}

      {stage === 'prepare' ? (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.section}>
            <Text variant="titleLarge">Tus fotos</Text>
            <View style={styles.actionRow}>
              <Button icon="image-multiple" mode="outlined" onPress={() => setGalleryPickerOpen(true)}>
                De la galeria
              </Button>
              <Button icon="plus" loading={working} mode="contained-tonal" onPress={uploadPhotos}>
                Subir nuevas
              </Button>
            </View>
            {state.photos.length === 0 ? (
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                Sube fotos o vuelve a la galeria para seleccionar las que quieras usar.
              </Text>
            ) : (
              <View style={styles.photoGrid}>
                {state.photos.map((photo) => (
                  <View key={photo.id} style={styles.gridItem}>
                    <PhotoTile
                      photo={photo}
                      selected={selectedPhotoIds.includes(photo.id)}
                      onPress={() =>
                        setSelectedPhotoIds((current) =>
                          current.includes(photo.id)
                            ? current.filter((id) => id !== photo.id)
                            : [...current, photo.id],
                        )
                      }
                    />
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={styles.section}>
            <View style={styles.rowBetween}>
              <Text variant="titleLarge">Variantes por foto</Text>
              <Chip>{variantsPerPhoto}</Chip>
            </View>
            <View style={styles.counter}>
              <Button
                icon="minus"
                mode="outlined"
                onPress={() => setVariantsPerPhoto((value) => Math.max(1, value - 1))}
              >
                Menos
              </Button>
              <Text variant="titleMedium">{totalVariants} publicaciones</Text>
              <Button
                icon="plus"
                mode="contained"
                onPress={() => setVariantsPerPhoto((value) => Math.min(10, value + 1))}
              >
                Mas
              </Button>
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.rowBetween}>
              <Text variant="titleLarge">Contextualizacion</Text>
              <Chip icon={photosWithoutContext.length > 0 ? 'alert-outline' : 'check'}>
                {photosWithoutContext.length} sin contexto
              </Chip>
            </View>
            {photosWithoutContext.length > 0 ? (
              <View style={styles.contextPanel}>
                <Text variant="bodyMedium">
                  {photosWithoutContext.length} fotos necesitan contexto antes de generar.
                </Text>
                <View style={styles.actionRow}>
                  <Chip
                    selected={effectiveContextMode === 'ai'}
                    onPress={() => setContextMode('ai')}
                  >
                    Auto con IA
                  </Chip>
                  <Chip
                    disabled={skipReview}
                    selected={effectiveContextMode === 'manual'}
                    onPress={() => setContextMode('manual')}
                  >
                    Manual
                  </Chip>
                </View>
                {skipReview ? (
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    En modo rapido, el contexto pendiente se completa con IA.
                  </Text>
                ) : null}
                {effectiveContextMode === 'manual'
                  ? photosWithoutContext.map((photo) => (
                      <View key={photo.id} style={styles.contextRow}>
                        <Image source={{ uri: photo.thumbnailUrl }} style={styles.contextImage} />
                        <TextInput
                          mode="outlined"
                          multiline
                          label={photo.name}
                          value={manualContext[photo.id] ?? ''}
                          onChangeText={(value) =>
                            setManualContext((current) => ({ ...current, [photo.id]: value }))
                          }
                          style={styles.flex}
                        />
                      </View>
                    ))
                  : null}
              </View>
            ) : (
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                Las fotos seleccionadas ya tienen contexto.
              </Text>
            )}
          </View>

          {skipReview ? (
            <View style={[styles.infoBox, { backgroundColor: theme.colors.surfaceVariant }]}>
              <MaterialCommunityIcons
                color={theme.colors.onSurfaceVariant}
                name="flash-outline"
                size={22}
              />
              <Text variant="bodyMedium" style={styles.flex}>
                No veras las publicaciones antes de programarse. Puedes editarlas despues en el calendario.
              </Text>
            </View>
          ) : null}

          {activeLimitReached ? (
            <Notice text="Tienes 3 lotes en curso. Espera a que termine uno o archivalo." />
          ) : null}
        </ScrollView>
      ) : null}

      {stage === 'generating' ? (
        <View style={styles.content}>
          <View style={styles.centerBlock}>
            <Text variant="displayMedium">
              {Math.min(readyCount, totalVariants)} / {totalVariants}
            </Text>
            <ProgressBar progress={totalVariants ? readyCount / totalVariants : 0} />
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              Tiempo estimado restante: {Math.max(1, totalVariants - readyCount)} min
            </Text>
          </View>
          <FlatList
            data={generatedVariants}
            keyExtractor={(item) => item.id}
            numColumns={3}
            contentContainerStyle={styles.generatedGrid}
            renderItem={({ item }) => (
              <View style={styles.variantTile}>
                <Image source={{ uri: item.imageUrl }} style={styles.variantImage} contentFit="cover" />
                <View style={styles.variantBadge}>
                  <StatusBadge status={item.status} />
                </View>
                <Text numberOfLines={2} variant="labelSmall">
                  {item.style}
                </Text>
              </View>
            )}
          />
          <Button mode="outlined" onPress={goHome}>
            Volver a la pantalla principal
          </Button>
        </View>
      ) : null}

      {stage === 'review' ? (
        <View style={styles.content}>
          {currentVariant ? (
            <View style={styles.reviewCard}>
              <View style={styles.rowBetween}>
                <Text variant="titleMedium">Revisar y programar</Text>
                <Chip>{reviewIndex + 1} de {generatedVariants.length}</Chip>
              </View>
              <Image
                source={{ uri: currentVariant.imageUrl }}
                style={styles.reviewImage}
                contentFit="cover"
              />
              <Text variant="titleSmall">Estilo: {currentVariant.style}</Text>
              <Text variant="bodyMedium" numberOfLines={5}>
                {currentVariant.text}
              </Text>
              <Button icon="pencil" mode="outlined" onPress={() => openTextEditor(currentVariant)}>
                Editar texto
              </Button>
              <View style={styles.reviewActions}>
                <Button icon="close" mode="outlined" onPress={() => setDecision(currentVariant.id, 'rejected')}>
                  Rechazar
                </Button>
                <Button icon="skip-next" mode="outlined" onPress={() => setDecision(currentVariant.id, 'skipped')}>
                  Saltar
                </Button>
                <Button icon="check" mode="contained" onPress={() => setDecision(currentVariant.id, 'approved')}>
                  Aceptar
                </Button>
              </View>
              <Button mode="text" onPress={acceptRemaining}>
                Aceptar todas las restantes
              </Button>
            </View>
          ) : (
            <View style={styles.centerBlock}>
              {skippedVariants.length > 0 ? (
                <>
                  <Text variant="headlineSmall" style={{ textAlign: 'center' }}>
                    Tienes {skippedVariants.length} variantes sin decision
                  </Text>
                  <View style={styles.actionRow}>
                    <Button mode="outlined" onPress={() => setReviewIndex(generatedVariants.findIndex((variant) => reviewDecisions[variant.id] === 'skipped'))}>
                      Revisar ahora
                    </Button>
                    <Button
                      mode="contained-tonal"
                      onPress={() => {
                        setReviewDecisions((current) => ({
                          ...current,
                          ...Object.fromEntries(skippedVariants.map((variant) => [variant.id, 'approved'])),
                        }));
                      }}
                    >
                      Aceptar todas
                    </Button>
                    <Button
                      mode="outlined"
                      onPress={() => {
                        setReviewDecisions((current) => ({
                          ...current,
                          ...Object.fromEntries(skippedVariants.map((variant) => [variant.id, 'rejected'])),
                        }));
                      }}
                    >
                      Rechazar todas
                    </Button>
                  </View>
                </>
              ) : (
                <>
                  <Text variant="headlineSmall" style={{ textAlign: 'center' }}>
                    {approvedVariants.length} publicaciones aprobadas
                  </Text>
                  <Button
                    disabled={approvedVariants.length === 0}
                    mode="contained"
                    onPress={() => setStage('schedule')}
                  >
                    Pasar a programacion
                  </Button>
                </>
              )}
            </View>
          )}
        </View>
      ) : null}

      {stage === 'schedule' ? (
        <ScrollView contentContainerStyle={styles.content}>
          {skipReview && working ? (
            <View style={styles.centerBlock}>
              <ActivityIndicator />
              <Text variant="titleMedium">Programando automaticamente...</Text>
            </View>
          ) : (
            <>
              <Text variant="titleLarge">{approvedVariants.length} publicaciones aprobadas</Text>
              <View style={[styles.suggestionBox, { backgroundColor: theme.colors.primaryContainer }]}>
                <Text variant="titleMedium" style={{ color: theme.colors.onPrimaryContainer }}>
                  Sugerencia para ti
                </Text>
                <Text variant="bodyMedium" style={{ color: theme.colors.onPrimaryContainer }}>
                  Basado en tu configuracion, estos horarios respetan dias activos, horario comercial y separacion minima.
                </Text>
                <View style={styles.schedulePreview}>
                  {suggestedSchedule.slice(0, 6).map((slot) => (
                    <Chip key={slot.variantId}>{formatSlot(slot.scheduledAt)}</Chip>
                  ))}
                </View>
                <Button
                  icon="check"
                  mode={useSuggestion ? 'contained' : 'outlined'}
                  onPress={() => setUseSuggestion(true)}
                >
                  Usar esta sugerencia
                </Button>
              </View>

              <View style={styles.section}>
                <Button mode="text" onPress={() => setUseSuggestion(false)}>
                  Personalizar manualmente
                </Button>
                {!useSuggestion ? (
                  <>
                    <View style={styles.counter}>
                      <Button icon="chevron-left" mode="outlined" onPress={() => setDistributionDays((value) => Math.max(1, value - 1))}>
                        Menos
                      </Button>
                      <Text variant="titleLarge">{distributionDays} dias</Text>
                      <Button icon="chevron-right" mode="contained" onPress={() => setDistributionDays((value) => value + 1)}>
                        Mas
                      </Button>
                    </View>
                    <View style={styles.schedulePreview}>
                      {manualSchedule.map((slot) => (
                        <Chip key={slot.variantId}>{formatSlot(slot.scheduledAt)}</Chip>
                      ))}
                    </View>
                  </>
                ) : null}
              </View>

              <View style={styles.section}>
                <Text variant="titleMedium">Vista previa del calendario</Text>
                <View style={styles.schedulePreview}>
                  {scheduleItems.map((item) => (
                    <Chip key={item.id}>{formatSlot(item.scheduledAt)}</Chip>
                  ))}
                </View>
              </View>
            </>
          )}
        </ScrollView>
      ) : null}

      {stage === 'success' ? (
        <View style={styles.content}>
          <View style={styles.successBlock}>
            <View style={[styles.successMark, { backgroundColor: theme.colors.primaryContainer }]}>
              <MaterialCommunityIcons color={theme.colors.primary} name="check" size={46} />
            </View>
            <Text variant="headlineSmall" style={{ textAlign: 'center' }}>
              Listo! Tu lote quedo programado.
            </Text>
            <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}>
              {successSummary}
            </Text>
            <Button mode="contained" onPress={goHome}>
              Ver en calendario
            </Button>
            <Button
              mode="outlined"
              onPress={() => {
                setDraftIdState(undefined);
                setSelectedPhotoIds([]);
                setReviewDecisions({});
                setVariantTexts({});
                setStage('prepare');
              }}
            >
              Crear otro lote
            </Button>
          </View>
        </View>
      ) : null}

      {stage === 'prepare' ? (
        <BottomActionBar
          backLabel="Atras"
          nextDisabled={!canGenerate}
          nextLabel={skipReview ? `Generar y programar ${totalVariants}` : `Generar ${totalVariants}`}
          nextLoading={working}
          onBack={goHome}
          onNext={startGeneration}
        />
      ) : null}

      {stage === 'schedule' && !skipReview ? (
        <BottomActionBar
          backLabel="Revision"
          nextDisabled={approvedVariants.length === 0}
          nextLabel="Confirmar programacion"
          nextLoading={working}
          onBack={() => setStage('review')}
          onNext={() => confirmSchedule(false)}
        />
      ) : null}

      <Portal>
        <Modal
          contentContainerStyle={[styles.pickerModal, { backgroundColor: theme.colors.surface }]}
          onDismiss={() => setGalleryPickerOpen(false)}
          visible={galleryPickerOpen}
        >
          <View style={styles.rowBetween}>
            <View style={styles.flex}>
              <Text variant="titleMedium">Galeria de Cadencia</Text>
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {selectedPhotoIds.length} seleccionadas
              </Text>
            </View>
            <Button compact onPress={() => setGalleryPickerOpen(false)}>
              Listo
            </Button>
          </View>
          <ScrollView contentContainerStyle={styles.photoGrid}>
            {state.photos.map((photo) => (
              <View key={photo.id} style={styles.gridItem}>
                <PhotoTile
                  photo={photo}
                  selected={selectedPhotoIds.includes(photo.id)}
                  onPress={() =>
                    setSelectedPhotoIds((current) =>
                      current.includes(photo.id)
                        ? current.filter((id) => id !== photo.id)
                        : [...current, photo.id],
                    )
                  }
                />
              </View>
            ))}
          </ScrollView>
        </Modal>

        <Modal
          contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.surface }]}
          onDismiss={() => setEditingVariantId(undefined)}
          visible={Boolean(editingVariantId)}
        >
          <Text variant="titleMedium">Editar texto</Text>
          <TextInput
            mode="outlined"
            multiline
            value={editingText}
            onChangeText={(value) => setEditingText(value.slice(0, facebookTextLimit))}
            style={styles.textArea}
          />
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            {facebookTextLimit - editingText.length} caracteres restantes
          </Text>
          <View style={styles.modalActions}>
            <Button onPress={() => setEditingVariantId(undefined)}>Cancelar</Button>
            <Button mode="contained" onPress={saveEditedText}>
              Guardar
            </Button>
          </View>
        </Modal>
      </Portal>
    </Screen>
  );
}

function PhaseProgress({ activeIndex }: { activeIndex: number }) {
  const theme = useTheme();

  return (
    <View style={styles.phaseWrap}>
      {phaseLabels.map((label, index) => {
        const completed = index < activeIndex;
        const active = index === activeIndex;

        return (
          <View key={label} style={styles.phaseItem}>
            <View
              style={[
                styles.phaseDot,
                {
                  backgroundColor: completed || active ? theme.colors.primary : theme.colors.surfaceVariant,
                },
              ]}
            >
              {completed ? (
                <MaterialCommunityIcons color={theme.colors.onPrimary} name="check" size={12} />
              ) : null}
            </View>
            <Text
              numberOfLines={1}
              variant="labelSmall"
              style={{ color: active ? theme.colors.primary : theme.colors.onSurfaceVariant }}
            >
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function buildVariantText(page: Page | undefined, photo: Photo | undefined, style: string): string {
  const pageName = page?.name ?? 'tu pagina';
  const settings = page?.settings;
  const voice = settings
    ? ` Tono: ${settings.brand.voice}${settings.brand.voiceCustom ? `, ${settings.brand.voiceCustom}` : ''}.`
    : '';
  const keywords = settings?.generation.seoKeywords.length
    ? ` Keywords: ${settings.generation.seoKeywords.join(', ')}.`
    : '';
  const suffix = settings?.generation.promptSuffix ? ` ${settings.generation.promptSuffix}` : '';
  const signature = settings?.brand.signature ? `\n\n${settings.brand.signature}` : '';
  const hashtags = settings?.brand.defaultHashtags.length
    ? `\n\n${settings.brand.defaultHashtags.join(' ')}`
    : '';
  const context = photo?.context
    ? ` Foto base: ${photo.context}`
    : ' Foto base pendiente de contexto detallado.';

  return `${pageName}: propuesta visual con estilo ${style}.${context}${voice}${keywords}${suffix}${signature}${hashtags}`;
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

function normalizeMimeType(mimeType: string | undefined): PhotoUpload['mimeType'] | undefined {
  if (mimeType === 'image/png' || mimeType === 'image/webp' || mimeType === 'image/jpeg') {
    return mimeType;
  }

  if (mimeType === 'image/jpg') {
    return 'image/jpeg';
  }

  return undefined;
}

function createLocalPhoto(pageId: string, uri: string, fileName: string | null | undefined, index: number): Photo {
  const createdAt = new Date().toISOString();
  const name = fileName?.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') || `Foto nueva ${index + 1}`;

  return {
    altText: name,
    category: 'otro',
    context: null,
    contextSource: null,
    createdAt,
    description: null,
    exif: {},
    fileHash: null,
    id: `local-${Date.now()}-${index}`,
    isFavorite: false,
    lowQuality: false,
    manualOverride: false,
    name,
    nameSource: 'manual',
    origin: 'phone_gallery',
    pageId,
    perceptualHash: null,
    qualityScore: {
      blur: 0.8,
      exposure: 0.7,
      resolution: 0,
    },
    stackId: null,
    stackIsPrimary: true,
    status: 'active',
    storagePath: uri,
    tags: [],
    takenAt: createdAt,
    thumbnailUrl: uri,
    trashedAt: null,
  };
}

function uploadNotice(uploadedCount: number, duplicateCount: number): string {
  if (uploadedCount > 0 && duplicateCount > 0) {
    return `${uploadedCount} fotos nuevas; ${duplicateCount} duplicadas ya estaban en galeria.`;
  }

  if (uploadedCount > 0) {
    return `${uploadedCount} fotos nuevas subidas a Cadencia.`;
  }

  if (duplicateCount > 0) {
    return `${duplicateCount} duplicadas ya estaban en galeria.`;
  }

  return 'No se agregaron fotos nuevas.';
}

function formatSlot(value: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    weekday: 'short',
  }).format(new Date(value));
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(value));
}

const styles = StyleSheet.create({
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  centerBlock: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.lg,
    justifyContent: 'center',
  },
  content: {
    flexGrow: 1,
    gap: spacing.lg,
    padding: spacing.md,
  },
  contextImage: {
    borderRadius: radius.small,
    height: 88,
    width: 88,
  },
  contextPanel: {
    gap: spacing.sm,
  },
  contextRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  counter: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'center',
  },
  flex: {
    flex: 1,
  },
  generatedGrid: {
    gap: spacing.sm,
  },
  gridItem: {
    padding: spacing.xs,
    width: '33.333%',
  },
  infoBox: {
    alignItems: 'center',
    borderRadius: radius.small,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  loading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 64,
  },
  modal: {
    borderRadius: radius.medium,
    gap: spacing.md,
    margin: spacing.md,
    padding: spacing.md,
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  notice: {
    borderRadius: radius.small,
    marginHorizontal: spacing.md,
    padding: spacing.md,
  },
  phaseDot: {
    alignItems: 'center',
    borderRadius: radius.full,
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
  phaseItem: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.xxs,
  },
  phaseWrap: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pickerModal: {
    borderRadius: radius.medium,
    gap: spacing.md,
    margin: spacing.md,
    maxHeight: '86%',
    padding: spacing.md,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -spacing.xs,
  },
  quickToggle: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    paddingRight: spacing.sm,
  },
  reviewActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  reviewCard: {
    gap: spacing.md,
  },
  reviewImage: {
    aspectRatio: 4 / 5,
    borderRadius: radius.small,
    width: '100%',
  },
  rowBetween: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  schedulePreview: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  section: {
    gap: spacing.md,
  },
  shell: {
    gap: 0,
    padding: 0,
  },
  successBlock: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.lg,
    justifyContent: 'center',
  },
  successMark: {
    alignItems: 'center',
    borderRadius: radius.full,
    height: 92,
    justifyContent: 'center',
    width: 92,
  },
  suggestionBox: {
    borderRadius: radius.small,
    gap: spacing.md,
    padding: spacing.md,
  },
  textArea: {
    minHeight: 180,
  },
  variantBadge: {
    left: spacing.xs,
    position: 'absolute',
    top: spacing.xs,
  },
  variantImage: {
    aspectRatio: 1,
    borderRadius: radius.small,
    width: '100%',
  },
  variantTile: {
    flex: 1,
    gap: spacing.xs,
    padding: spacing.xs,
  },
});
