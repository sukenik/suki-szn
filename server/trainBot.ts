import * as tf from '@tensorflow/tfjs'
import fs from 'fs'
import path from 'path'
import { DATA_FILE_NAME, MODEL_FILE_NAME } from './src/consts'

async function train() {
    if (!fs.existsSync(DATA_FILE_NAME)) {
        console.error(`File: ${DATA_FILE_NAME}, not found`)
        return
    }

    const rawData = JSON.parse(fs.readFileSync(DATA_FILE_NAME, 'utf8'))

    const hits = rawData.filter((d: any) => d.output[0] === 1)
    const misses = rawData.filter((d: any) => d.output[0] === 0)

    console.log(`Before balance: ${hits.length} hits, ${misses.length} misses`)

    const balancedMisses = misses.slice(0, hits.length)
    const balancedData = [...hits, ...balancedMisses]

    const finalData = balancedData.sort(() => Math.random() - 0.5)

    console.log(`After balance: ${finalData.length} total samples`)

    const inputs = finalData.map((d: any) => [
        d.input[0] / 1000,
        d.input[1] / 5,
        d.input[2] / 5,
        d.input[3] / Math.PI
    ])
    const outputs = finalData.map((d: any) => d.output)

    const xs = tf.tensor2d(inputs)
    const ys = tf.tensor2d(outputs)

    const model = tf.sequential()
    model.add(tf.layers.dense({ units: 32, activation: 'relu', inputShape: [4] }))
    model.add(tf.layers.dense({ units: 16, activation: 'relu' }))
    model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }))

    model.compile({
        optimizer: tf.train.adam(0.001),
        loss: 'binaryCrossentropy',
        metrics: ['accuracy']
    })

    console.log('--- Starting training ---')

    await model.fit(xs, ys, {
        epochs: 150,
        batchSize: 32,
        shuffle: true,
        callbacks: {
            onEpochEnd: (epoch, logs) => {
                if (epoch % 10 === 0) {
                    console.log(`Epoch ${epoch}: Loss = ${logs?.loss.toFixed(4)}, Acc = ${logs?.acc.toFixed(4)}`)
                }
            }
        }
    })

    await model.save(tf.io.withSaveHandler(async (artifacts) => {
        const weights = artifacts.weightData
        if (!weights) throw new Error('No weight data!')

        const weightsBuffer = weights instanceof ArrayBuffer 
            ? Buffer.from(weights) 
            : Buffer.from((weights as any)[0])

        const manifest = {
            modelTopology: artifacts.modelTopology,
            weightSpecs: artifacts.weightSpecs,
            weightData: weightsBuffer.toString('base64')
        }

        const modelPath = path.join(__dirname, '..', 'ai', MODEL_FILE_NAME)

        fs.writeFileSync(modelPath, JSON.stringify(manifest))
        return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' } }
    }))

    console.log('--- Model saved successfully ---')
}

train()