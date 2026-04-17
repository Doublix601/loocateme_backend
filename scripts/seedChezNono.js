import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Location } from '../src/models/Location.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Charger le .env depuis la racine du projet loocateme_backend
dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGO_URI = process.env.MONGODB_URI_LOCAL || process.env.MONGODB_URI;

async function seedChezNono() {
  if (!MONGO_URI) {
    console.error('Erreur: MONGODB_URI_LOCAL ou MONGODB_URI n\'est pas défini dans le fichier .env');
    process.exit(1);
  }

  try {
    console.log('Connexion à MongoDB...');
    // Masquer le mot de passe dans les logs
    const maskedUri = MONGO_URI.replace(/:([^:@]+)@/, ':****@');
    console.log(`Utilisation de l'URI: ${maskedUri}`);

    await mongoose.connect(MONGO_URI);
    console.log('Connecté.');

    const name = 'Chez Nono';
    const lat = 49.413916;
    const lon = 2.822027;
    const type = 'TEST 🤖';
    const shouldDelete = false; // Mettre à true si on veut supprimer le lieu

    // On cherche s'il existe déjà pour éviter les doublons (même si pas d'osmId)
    // On cherche par nom ou par position approximative si nécessaire, ici on va rester sur le nom
    let existing = await Location.findOne({ name });

    if (existing) {
      if (shouldDelete) {
        console.log('Le lieu "Chez Nono" existe et doit être supprimé...');
        await Location.deleteOne({ _id: existing._id });
        console.log('Supprimé avec succès.');
      } else {
        console.log('Le lieu "Chez Nono" existe déjà. Mise à jour complète...');
        existing.name = name;
        existing.type = type;
        existing.location = {
          type: 'Point',
          coordinates: [lon, lat],
        };
        existing.stars = 3; // On s'assure qu'il garde ses 3 étoiles
        existing.shouldDelete = false; // On s'assure qu'il n'est pas marqué pour suppression
        await existing.save();
        console.log('Mis à jour.');
      }
    } else {
      if (shouldDelete) {
        console.log('Le lieu "Chez Nono" n\'existe pas et shouldDelete est à true. Rien à faire.');
      } else {
        console.log('Création du lieu "Chez Nono"...');
        await Location.create({
          name,
          type,
          location: {
            type: 'Point',
            coordinates: [lon, lat],
          },
          stars: 3, // On lui met 3 étoiles pour qu'il ne soit pas supprimé par la sync OSM
          shouldDelete: false,
        });
        console.log('Créé avec succès.');
      }
    }
  } catch (error) {
    console.error('Erreur lors de la création du lieu:', error);
  } finally {
    await mongoose.disconnect();
  }
}

seedChezNono();
