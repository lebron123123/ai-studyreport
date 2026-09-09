// 由 scripts/generate-release-manifest.mjs 自动生成，请勿手工改写。
export default {
  "schemaVersion": 1,
  "release": {
    "name": "ai-studyreport",
    "version": "1.0.0",
    "releaseId": "ai-studyreport@1.0.0"
  },
  "reportLogic": {
    "rent": {
      "setId": "report-logic-rent-v1",
      "version": 1,
      "status": "published",
      "rules": 137,
      "chapters": 14,
      "canonicalPath": "data/report-logic-rent-v1.json",
      "runtimePath": "functions/api/_reportlogic-seed.js",
      "canonicalSha256": "fbc05edce35566e1667ba317218168a81b01b2610479ed783ab2bd672a90d7bc"
    },
    "gaibao": {
      "setId": "report-logic-gaibao-v1",
      "version": 2,
      "status": "published",
      "rules": 78,
      "chapters": 13,
      "canonicalPath": "data/report-logic-gaibao-v1.json",
      "runtimePath": "functions/api/_reportlogic-gaibao-seed.js",
      "canonicalSha256": "5aa64a3c4043b80b2505a39874f270c4e97021d5af5bfd2588d5e02230aa6513"
    }
  },
  "reportTables": {
    "rent": {
      "setId": "report-table-templates-rent-v1",
      "version": 1,
      "projectType": "rent",
      "templates": 33,
      "file": "data/report-table-templates-rent-v1.json",
      "fileSha256": "1f1a2f49aadd8e8dedcd99cddabf7cd6e4e9c28232f2436ee3beaf8bfbaf58e8"
    },
    "gaibaoHousing": {
      "setId": "report-table-templates-gaibao-housing-v1",
      "version": 4,
      "projectType": "gaibao-housing",
      "templates": 26,
      "file": "data/report-table-templates-gaibao-housing-v1.json",
      "fileSha256": "796d4424bade9e13c2a39dbd41a3597a404ac4da6e76ae6a6c665e567019f0f3"
    },
    "gaibaoCommercial": {
      "setId": "report-table-templates-gaibao-commercial-v1",
      "version": 1,
      "projectType": "gaibao-commercial",
      "templates": 22,
      "file": "data/report-table-templates-gaibao-commercial-v1.json",
      "fileSha256": "2e227375a6fdac13c74dec01927ff7197210e61d1a926b5132f0a8e6d43f105e"
    }
  },
  "evaluation": {
    "training": {
      "file": "data/report-golden-tax-v2-training.json",
      "datasetRole": "training",
      "approvalStatus": "phase_draft_not_manager_approved",
      "sourceProjectId": "tax-batch1-housing-renovation",
      "fileSha256": "6cdff7d76f05ef349b1716d6c8695934660155d58ce1a22abdac414a54b551d6",
      "sourceDocumentSha256": "b0da055e5e1c5b570231a661a8d1fcaf2c16f39bf85738e38e6e2d7ce9fa73b6"
    },
    "holdout": {
      "file": "data/report-golden-longyue-holdout.json",
      "datasetRole": "holdout",
      "approvalStatus": "historical_document_holdout_candidate",
      "sourceProjectId": "longyue-commercial-renovation-20260629",
      "fileSha256": "cd5586cf6f1ee64eb3a84f3494efcff4c21f53425e1580c13edfe013536f99ac",
      "sourceDocumentSha256": "d850413026be64edc4fce103ad457abaf8a263f13cdf8ee9c413eb383ae880ae"
    }
  },
  "migrations": {
    "count": 33,
    "latest": "0033_investment_step4.sql",
    "orderedListSha256": "5f0f8b82c7843c8553353606d700aed85ce6715aeac62f9f722bc2b6a814843e"
  },
  "capabilities": {
    "evidenceSigningGate": {
      "state": "implemented",
      "contract": "report-evidence-graph.js#preSubmitAudit"
    },
    "projectRbac": {
      "state": "implemented",
      "roles": [
        "OWNER",
        "EDITOR",
        "VIEWER"
      ],
      "contract": "project-intelligence.js#permissionsFor"
    },
    "asyncJobsAndCheckpoints": {
      "state": "implemented",
      "contract": "functions/api/_agent-enterprise.js"
    },
    "usageAndCostLedger": {
      "state": "implemented",
      "contract": "migrations/0009_agent_enterprise.sql"
    },
    "promptLineage": {
      "state": "implemented_per_report_version",
      "contract": "report-trust.js",
      "releaseManifestStatus": "runtime_lineage_required"
    },
    "sloProductionGate": {
      "state": "implemented",
      "contract": "investment-ops.js#evaluateSlo",
      "target": {
        "concurrency": 50,
        "p95Ms": 5000,
        "successRate": 0.99,
        "recoveryRate": 0.95
      }
    },
    "originalObjectStorage": {
      "state": "adapter_ready",
      "binding": "RAG_OBJECTS",
      "capacityTarget": {
        "objects": 1000000,
        "validation": "external_load_test_required"
      }
    },
    "oaIntegration": {
      "state": "external_configuration_required",
      "binding": "OA_BASE_URL",
      "validation": "vendor_contract_and_credentials_required"
    },
    "highAvailability": {
      "state": "deployment_infrastructure_required",
      "binding": "HA_DEPLOYMENT_ID",
      "validation": "failover_drill_required"
    }
  }
};
