/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, module */

const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

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
const OPTIONAL_HARDWARE_FEATURES = new Set(['android.hardware.camera']);
const SCOPED_STORAGE_REMOVED_PERMISSIONS = new Set([
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
]);

const backupRulesXml = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
  <exclude domain="root" path="."/>
  <exclude domain="file" path="."/>
  <exclude domain="database" path="."/>
  <exclude domain="sharedpref" path="."/>
  <exclude domain="external" path="."/>
  <exclude domain="device_root" path="."/>
  <exclude domain="device_file" path="."/>
  <exclude domain="device_database" path="."/>
  <exclude domain="device_sharedpref" path="."/>
</full-backup-content>
`;

const dataExtractionRulesXml = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup disableIfNoEncryptionCapabilities="true">
    <exclude domain="root" path="."/>
    <exclude domain="file" path="."/>
    <exclude domain="database" path="."/>
    <exclude domain="sharedpref" path="."/>
    <exclude domain="external" path="."/>
    <exclude domain="device_root" path="."/>
    <exclude domain="device_file" path="."/>
    <exclude domain="device_database" path="."/>
    <exclude domain="device_sharedpref" path="."/>
  </cloud-backup>
  <device-transfer>
    <exclude domain="root" path="."/>
    <exclude domain="file" path="."/>
    <exclude domain="database" path="."/>
    <exclude domain="sharedpref" path="."/>
    <exclude domain="external" path="."/>
    <exclude domain="device_root" path="."/>
    <exclude domain="device_file" path="."/>
    <exclude domain="device_database" path="."/>
    <exclude domain="device_sharedpref" path="."/>
  </device-transfer>
</data-extraction-rules>
`;

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

function getFeatureName(feature) {
  return feature?.$?.['android:name'];
}

function createOptionalFeature(featureName) {
  return {
    $: {
      'android:name': featureName,
      'android:required': 'false',
    },
  };
}

function getComponentName(component) {
  return component?.$?.['android:name'];
}

function createRemoveReceiver(receiverName) {
  return {
    $: {
      'android:name': receiverName,
      'tools:ignore': 'MissingClass',
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
  config = withAndroidManifest(config, (expoConfig) => {
    const manifest = expoConfig.modResults.manifest;
    manifest.queries = manifest.queries ?? [{}];

    const queries = manifest.queries[0];

    if (manifest['uses-permission']) {
      for (const permission of manifest['uses-permission']) {
        const permissionName = permission?.$?.['android:name'];

        if (SCOPED_STORAGE_REMOVED_PERMISSIONS.has(permissionName) && permission.$?.['tools:node'] === 'remove') {
          permission.$['tools:ignore'] = 'ScopedStorage';
        }
      }
    }

    if (queries?.intent) {
      queries.intent = queries.intent.filter((intent) => !REMOVED_QUERY_ACTIONS.has(getActionName(intent)));
    }

    queries.intent = queries.intent ?? [];
    for (const actionName of REMOVED_QUERY_ACTIONS) {
      queries.intent.push(createRemoveIntent(actionName));
    }
    queries.intent.push(createImageContentIntent());

    manifest['uses-feature'] = manifest['uses-feature'] ?? [];
    const existingFeatures = new Set(manifest['uses-feature'].map(getFeatureName).filter(Boolean));
    for (const featureName of OPTIONAL_HARDWARE_FEATURES) {
      if (!existingFeatures.has(featureName)) {
        manifest['uses-feature'].push(createOptionalFeature(featureName));
      }
    }

    const application = manifest.application?.[0];
    if (application) {
      application.$ = application.$ ?? {};
      application.$['android:dataExtractionRules'] = '@xml/data_extraction_rules';
      application.$['android:fullBackupContent'] = '@xml/backup_rules';
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

  return withDangerousMod(config, [
    'android',
    async (expoConfig) => {
      const xmlDir = path.join(expoConfig.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');

      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(path.join(xmlDir, 'backup_rules.xml'), backupRulesXml);
      fs.writeFileSync(path.join(xmlDir, 'data_extraction_rules.xml'), dataExtractionRulesXml);

      return expoConfig;
    },
  ]);
}

module.exports = withAndroidManifestHardening;
