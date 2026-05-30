const { withAndroidManifest } = require('@expo/config-plugins');

const REMOVED_QUERY_ACTIONS = new Set([
  'android.intent.action.GET_CONTENT',
  'android.intent.action.OPEN_DOCUMENT_TREE',
  'android.media.action.IMAGE_CAPTURE',
  'android.media.action.ACTION_VIDEO_CAPTURE',
]);

const REMOVED_RECEIVERS = new Set(['androidx.profileinstaller.ProfileInstallReceiver']);
const REMOVED_META_DATA = new Set([
  'expo.modules.updates.ENABLED',
  'expo.modules.updates.ENABLE_BSDIFF_PATCH_SUPPORT',
  'expo.modules.updates.EXPO_RUNTIME_VERSION',
  'expo.modules.updates.EXPO_UPDATES_CHECK_ON_LAUNCH',
  'expo.modules.updates.EXPO_UPDATES_LAUNCH_WAIT_MS',
  'expo.modules.updates.EXPO_UPDATE_URL',
]);

function getActionName(intent) {
  const action = intent?.action?.[0]?.$;
  return action?.['android:name'];
}

function createRemoveIntent(actionName) {
  const intent = {
    $: {
      'tools:node': 'remove',
    },
    action: [
      {
        $: {
          'android:name': actionName,
        },
      },
    ],
  };

  if (actionName === 'android.intent.action.GET_CONTENT') {
    intent.category = [
      {
        $: {
          'android:name': 'android.intent.category.OPENABLE',
        },
      },
    ];
    intent.data = [
      {
        $: {
          'android:mimeType': '*/*',
        },
      },
    ];
  }

  return intent;
}

function createImageContentIntent() {
  return {
    action: [
      {
        $: {
          'android:name': 'android.intent.action.GET_CONTENT',
        },
      },
    ],
    category: [
      {
        $: {
          'android:name': 'android.intent.category.OPENABLE',
        },
      },
    ],
    data: [
      {
        $: {
          'android:mimeType': 'image/*',
        },
      },
    ],
  };
}

function getComponentName(component) {
  return component?.$?.['android:name'];
}

function createRemoveReceiver(receiverName) {
  return {
    $: {
      'android:name': receiverName,
      'tools:node': 'remove',
    },
  };
}

function getMetaDataName(metaData) {
  return metaData?.$?.['android:name'];
}

function createRemoveMetaData(metaDataName) {
  return {
    $: {
      'android:name': metaDataName,
      'tools:node': 'remove',
    },
  };
}

function withAndroidManifestHardening(config) {
  return withAndroidManifest(config, (expoConfig) => {
    const manifest = expoConfig.modResults.manifest;
    manifest.queries = manifest.queries ?? [{}];

    const queries = manifest.queries[0];

    if (queries?.intent) {
      queries.intent = queries.intent.filter((intent) => !REMOVED_QUERY_ACTIONS.has(getActionName(intent)));
    }

    queries.intent = queries.intent ?? [];
    for (const actionName of REMOVED_QUERY_ACTIONS) {
      queries.intent.push(createRemoveIntent(actionName));
    }
    queries.intent.push(createImageContentIntent());

    const application = manifest.application?.[0];
    if (application) {
      application.receiver = application.receiver ?? [];
      application.receiver = application.receiver.filter((receiver) => !REMOVED_RECEIVERS.has(getComponentName(receiver)));

      for (const receiverName of REMOVED_RECEIVERS) {
        application.receiver.push(createRemoveReceiver(receiverName));
      }

      application['meta-data'] = application['meta-data'] ?? [];
      application['meta-data'] = application['meta-data'].filter((metaData) => !REMOVED_META_DATA.has(getMetaDataName(metaData)));

      for (const metaDataName of REMOVED_META_DATA) {
        application['meta-data'].push(createRemoveMetaData(metaDataName));
      }
    }

    return expoConfig;
  });
}

module.exports = withAndroidManifestHardening;
