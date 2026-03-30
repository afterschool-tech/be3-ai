describe('IntelliSense resolved_product localWordIndex selection', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    function setupMocks({ message, products }) {
        const captured = { statementPreEntities: null };

        // Mock debug logging to keep test output clean
        jest.doMock(require.resolve('../src/utils/debugLogger'), () => ({
            logDebug: () => {}
        }));

        // Avoid network calls (transformer, backend, etc.)
        jest.doMock(require.resolve('axios'), () => ({
            post: async () => {
                throw new Error('axios.post should not be called in this test');
            }
        }));

        // Minimal pipeline stage mocks
        jest.doMock(require.resolve('../src/services/intentResolver/pipeline/fuzzyMatcher'), () => ({
            correctText: (t) => t
        }));

        jest.doMock(require.resolve('../src/services/intentResolver/pipeline/preprocessor'), () => ({
            preprocess: () => ({
                statements: [{ text: message, original: message, negated: false }],
                isMultiIntent: false
            })
        }));

        jest.doMock(require.resolve('../src/utils/semanticClauseResolver'), () => ({
            resolveClausesGlobal: () => ({ globalEntities: [], categoryHints: [] })
        }));

        jest.doMock(require.resolve('../src/services/intentResolver/pipeline/contextResolver'), () => ({
            shouldSkipAmbiguousReference: () => false,
            resolveReferences: (text) => ({ resolvedText: text, resolutions: [] })
        }));

        jest.doMock(require.resolve('../src/services/intelliSense'), () => ({
            analyze: async () => ({
                statements: [
                    {
                        products,
                        skip_resolve: []
                    }
                ]
            })
        }));

        jest.doMock(require.resolve('../src/services/intentResolver/pipeline/ambientContextResolver'), () => ({
            resolveAmbientContext: async () => null,
            buildAmbientEntities: () => []
        }));

        jest.doMock(require.resolve('../src/services/intentResolver/pipeline/extractionPositionTracker'), () => ({
            createPositionTracker: () => ({})
        }));

        jest.doMock(require.resolve('../src/services/intentResolver/pipeline/entityExtractor'), () => ({
            extractEntities: (
                cleanedText,
                storeContext,
                idfMap,
                positionTracker,
                resolutions,
                statementPreEntities
            ) => {
                captured.statementPreEntities = statementPreEntities;
                return { entities: [], residualWords: [], shape: '' };
            }
        }));

        jest.doMock(require.resolve('../src/services/intentResolver/pipeline/schemaResolver'), () => ({
            resolveIntent: () => ({
                signalDensity: 0,
                entityCount: 0,
                candidates: [
                    {
                        intentName: 'product_compare',
                        score: 1,
                        matchedKeywords: [],
                        matchedParams: [],
                        deterministicBreakdown: []
                    }
                ]
            })
        }));

        jest.doMock(require.resolve('../src/services/intentResolver/pipeline/parameterExtractor'), () => ({
            extractParameters: async () => ({})
        }));

        jest.doMock(require.resolve('../src/services/intentResolver/pipeline/parameterBleeder'), () => ({
            bleedParameters: (x) => x
        }));

        jest.doMock(require.resolve('../src/services/intentResolver/pipeline/intentPorter'), () => ({
            portIntents: (x) => x
        }));

        jest.doMock(require.resolve('../src/services/intentResolver/pipeline/parameterNormalizer'), () => ({
            normalizeParameters: (x) => x
        }));

        jest.doMock(require.resolve('../src/services/intentResolver/pipeline/toolMapper'), () => ({
            mapToTools: () => []
        }));

        jest.doMock(require.resolve('../src/services/intentResolver/pipeline/microstateRunner'), () => ({
            run: async () => ({})
        }));

        jest.doMock(require.resolve('../src/services/intentResolver/pipeline/stack'), () => ({
            executeIntentStack: async () => ({ stack_active: false, total_intents: 0 })
        }));

        jest.doMock(require.resolve('../src/services/intentResolver/pipeline/contextReconciler'), () => ({
            reconcile: (x) => x
        }));

        jest.doMock(require.resolve('../src/services/intentResolver/pipeline/nlpCleaner'), () => ({
            stripSocialNoise: (t) => t,
            cleanText: (t) => t
        }));

        jest.doMock(require.resolve('../src/services/intentResolver/pipeline/residualChunkAnalyzer'), () => ({
            runResidualChunkAnalysis: async () => ({})
        }));

        jest.doMock(require.resolve('../src/services/intentResolver/pipeline/pipelineConfidence'), () => ({
            calculatePipelineConfidence: () => ({ score: 1, verdict: 'CONFIDENT', signalCount: 0, signals: [] })
        }));

        jest.doMock(require.resolve('../src/services/intentResolver/pipeline/microstateFeatureProvider'), () => ({
            getFeatureInjections: async () => ({ options: [] })
        }));

        jest.doMock(require.resolve('../src/state/stateManager'), () => ({
            getMicrostate: async () => null,
            updateState: async () => {},
            clearStack: async () => {},
            decrementSearchContextTTL: async () => {},
            updateSearchContext: async () => {},
            clearSearchContext: async () => {},
            getSearchContext: async () => null
            ,
            setMicrostate: async () => {}
        }));

        jest.doMock(require.resolve('../src/middleware/suggestionHelper'), () => ({
            isConfirmation: () => 'no'
        }));

        // Category helpers used in various branches
        jest.doMock(require.resolve('../src/context/categoryHelpers'), () => ({
            getParent: () => null,
            getSiblings: () => [],
            getPath: () => [],
            isRoot: () => false,
            findById: () => null
        }));

        // Misc utilities that may be imported/used in later stages
        jest.doMock(require.resolve('../src/utils/responseResolver'), () => ({
            resolveEngineeredToken: () => null,
            resolveGroupedOrdinal: () => null,
            resolveOrdinal: () => null
        }));

        jest.doMock(require.resolve('../src/utils/apiClient'), () => ({
            callBackendAPI: async () => ({})
        }));

        jest.doMock(require.resolve('../src/utils/productUtility'), () => ({
            processProductList: (x) => x
        }));

        return captured;
    }

    test('disambiguates "iphone 12" vs "iphone 17" by anchoring to digit tokens', async () => {
        const message = 'iphone 12 or iphone 17';
        const products = [{ name: 'iphone 12' }, { name: 'iphone 17' }];
        const captured = setupMocks({ message, products });

        const { resolveAndMap } = require('../src/services/intentResolver');
        await resolveAndMap(
            message,
            { user_id: 'u1', session_id: 's1', skipTransformer: true },
            async () => '{}',
            {}
        );

        const resolved = (captured.statementPreEntities || []).filter(e => e.type === 'resolved_product');
        expect(resolved).toHaveLength(2);
        const byValue = Object.fromEntries(resolved.map(e => [String(e.value).toLowerCase(), e.localWordIndex]));
        expect(byValue['iphone 12']).toBe(1);
        expect(byValue['iphone 17']).toBe(4);
        expect(byValue['iphone 12']).not.toBe(byValue['iphone 17']);

        const byValueWordIndices = Object.fromEntries(
            resolved.map(e => [String(e.value).toLowerCase(), e.wordIndices])
        );
        // Tight contiguous spans (no cross-mention "iphone" leakage)
        expect(byValueWordIndices['iphone 12']).toEqual([0, 1]);
        expect(byValueWordIndices['iphone 17']).toEqual([3, 4]);
    });

    test('disambiguates "airpods pro" vs "airpods max" by anchoring to rare tokens', async () => {
        const message = 'airpods pro or airpods max';
        const products = [{ name: 'airpods pro' }, { name: 'airpods max' }];
        const captured = setupMocks({ message, products });

        const { resolveAndMap } = require('../src/services/intentResolver');
        await resolveAndMap(
            message,
            { user_id: 'u1', session_id: 's1', skipTransformer: true },
            async () => '{}',
            {}
        );

        const resolved = (captured.statementPreEntities || []).filter(e => e.type === 'resolved_product');
        expect(resolved).toHaveLength(2);
        const byValue = Object.fromEntries(resolved.map(e => [String(e.value).toLowerCase(), e.localWordIndex]));
        expect(byValue['airpods pro']).toBe(1);
        expect(byValue['airpods max']).toBe(4);
        expect(byValue['airpods pro']).not.toBe(byValue['airpods max']);

        const byValueWordIndices = Object.fromEntries(
            resolved.map(e => [String(e.value).toLowerCase(), e.wordIndices])
        );
        expect(byValueWordIndices['airpods pro']).toEqual([0, 1]);
        expect(byValueWordIndices['airpods max']).toEqual([3, 4]);
    });
});

